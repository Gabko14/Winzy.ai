// Package httpserver builds the HTTP server, its middleware stack, and
// graceful shutdown for the API. Middleware order is fixed: panic recovery,
// then request logging, then CORS, then the router. See PM REVIEW ADDENDUM
// on winzy.ai-rdc7.1 for the logging convention every later module inherits.
package httpserver

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/Gabko14/winzy/backend/internal/reqid"
)

// Middleware wraps an http.Handler with additional behavior.
type Middleware func(http.Handler) http.Handler

const maxRequestBodyBytes int64 = 1 << 20

// Chain applies middlewares in the order given: the first middleware is
// outermost (sees the request first, the response last).
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

// RequestID installs the request ID before logging and recovery so both
// middlewares observe the same value even when a handler panics.
func RequestID() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := reqid.New()
			w.Header().Set("X-Request-Id", id)
			next.ServeHTTP(w, r.WithContext(reqid.WithContext(r.Context(), id)))
		})
	}
}

// Recovery recovers panics in the handler chain, logging them at error level
// with the request ID before returning a generic 500. RequestLogging wraps
// Recovery in the production stack so the recovered response still emits a
// complete request line. If bytes were already committed, net/http cannot
// replace the status/body: the committed status remains and the generic
// error JSON is appended. sensitivePathPrefixes is the same list
// RequestLogging takes
// (see its doc comment and redactPath) — a panic mid-request on a sensitive
// route (e.g. GET /social/witness/{token}) must not leak the token into the
// panic log line either; a crash is exactly the moment someone is reading
// logs.
func Recovery(logger *slog.Logger, sensitivePathPrefixes ...string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := reqid.FromContext(r.Context())
			if id == "" {
				id = reqid.New()
				r = r.WithContext(reqid.WithContext(r.Context(), id))
				w.Header().Set("X-Request-Id", id)
			}

			defer func() {
				if rec := recover(); rec != nil {
					logger.Error("panic recovered",
						"request_id", id,
						"method", r.Method,
						"path", redactPath(r.URL.Path, sensitivePathPrefixes),
						"panic", rec,
					)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":"internal server error"}`))
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}

// statusRecorder captures the status code written by the wrapped handler so
// RequestLogging can log it after the fact; net/http gives no other way to
// observe it.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if s.wroteHeader {
		return
	}
	s.wroteHeader = true
	s.status = status
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(p []byte) (int, error) {
	if !s.wroteHeader {
		s.WriteHeader(http.StatusOK)
	}
	return s.ResponseWriter.Write(p)
}

// redactPath returns path unchanged unless it starts with one of
// sensitivePrefixes, in which case everything after the matching prefix is
// replaced with "[redacted]" — e.g. "/social/witness/AbC123..." logs as
// "/social/witness/[redacted]". Kept generic (no knowledge of what a
// "witness token" is, no import of internal/social) so httpserver stays
// free of module-specific dependencies; callers (cmd/api/main.go) supply
// the actual sensitive prefixes.
func redactPath(path string, sensitivePrefixes []string) string {
	for _, prefix := range sensitivePrefixes {
		if strings.HasPrefix(path, prefix) {
			return prefix + "[redacted]"
		}
	}
	return path
}

// bodyCarryingMethod reports whether method is one of the three the API
// ever expects a JSON body on. Every other method (GET, DELETE, HEAD,
// OPTIONS) gets only a lazy http.MaxBytesReader wrap: bounding the read if
// a handler ever consults the body, without eagerly buffering up to 1 MiB
// for requests that never carry one.
func bodyCarryingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return true
	default:
		return false
	}
}

// BodyLimit caps every request body at 1 MiB. Oversized requests receive
// C# Kestrel's 413 contract with an empty body. POST/PUT/PATCH bodies are
// read eagerly into a re-readable buffer (handlers decode from r.Body
// directly); every other method only gets a lazy MaxBytesReader wrap, so a
// flood of bodyless GETs never forces allocation before routing. Must run
// after rate limiting and inside CORS (see cmd/api/main.go's wiring) so a
// 413 still carries CORS headers and an oversized-body attack is rate
// limited before any bytes are read.
func BodyLimit() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > maxRequestBodyBytes {
				w.WriteHeader(http.StatusRequestEntityTooLarge)
				return
			}
			if r.Body == nil || r.Body == http.NoBody {
				next.ServeHTTP(w, r)
				return
			}
			if !bodyCarryingMethod(r.Method) {
				r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
				next.ServeHTTP(w, r)
				return
			}
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBodyBytes))
			if err != nil {
				var maxErr *http.MaxBytesError
				if errors.As(err, &maxErr) {
					w.WriteHeader(http.StatusRequestEntityTooLarge)
					return
				}
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			next.ServeHTTP(w, r)
		})
	}
}

// RequestLogging logs one structured line per request: request_id, method,
// path, status, duration_ms, and user_id when the request is authenticated.
// sensitivePathPrefixes lists path prefixes whose trailing segment must
// never reach the log line verbatim (see redactPath) — e.g.
// "/social/witness/", so a Witness Link token never lands in stdout/Railway
// logs. This is deliberately stricter than the old system (the old gateway
// logged full request paths, tokens included); the never-log-a-token rule
// on winzy.ai-rdc7.4 applies here too.
func RequestLogging(logger *slog.Logger, sensitivePathPrefixes ...string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			// A mutable requestState (rather than another context.WithValue)
			// is installed here so that an inner middleware further down the
			// chain (e.g. JWT auth in rdc7.2) can call SetUserID and have it
			// show up below, after next.ServeHTTP returns — context values
			// set deeper in the chain are otherwise invisible up here.
			ctx, state := withRequestState(r.Context())
			next.ServeHTTP(rec, r.WithContext(ctx))

			state.mu.Lock()
			userID := state.userID
			state.mu.Unlock()

			attrs := []any{
				"request_id", reqid.FromContext(r.Context()),
				"method", r.Method,
				"path", redactPath(r.URL.Path, sensitivePathPrefixes),
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
			}
			if userID != "" {
				attrs = append(attrs, "user_id", userID)
			}
			logger.Info("request", attrs...)
		})
	}
}

// CORS allows browser requests only from allowedOrigin (the Expo web app),
// echoing it back (rather than "*") since the client sends
// credentials:"include" and browsers reject wildcard origins on credentialed
// requests.
func CORS(allowedOrigin string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Vary is set unconditionally: responses differ by Origin whether
			// or not this particular origin was allowed, and a cache must
			// never serve an ACAO-less response to the allowed origin.
			w.Header().Add("Vary", "Origin")

			origin := r.Header.Get("Origin")
			if origin != "" && origin == allowedOrigin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}

			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Timezone")
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
