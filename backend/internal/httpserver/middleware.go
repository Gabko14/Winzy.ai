// Package httpserver builds the HTTP server, its middleware stack, and
// graceful shutdown for the API. Middleware order is fixed: panic recovery,
// then request logging, then CORS, then the router. See PM REVIEW ADDENDUM
// on winzy.ai-rdc7.1 for the logging convention every later module inherits.
package httpserver

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/Gabko14/winzy/backend/internal/reqid"
)

// Middleware wraps an http.Handler with additional behavior.
type Middleware func(http.Handler) http.Handler

// Chain applies middlewares in the order given: the first middleware is
// outermost (sees the request first, the response last).
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

// Recovery assigns each request a request ID (stored in context and echoed
// as the X-Request-Id response header) and recovers panics in the handler
// chain, logging them at error level with that request ID before returning a
// generic 500. It must be the outermost middleware so no other middleware's
// panic escapes unlogged, and so every later log line has a request ID to
// attach to. sensitivePathPrefixes is the same list RequestLogging takes
// (see its doc comment and redactPath) — a panic mid-request on a sensitive
// route (e.g. GET /social/witness/{token}) must not leak the token into the
// panic log line either; a crash is exactly the moment someone is reading
// logs.
func Recovery(logger *slog.Logger, sensitivePathPrefixes ...string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := reqid.New()
			ctx := reqid.WithContext(r.Context(), id)
			w.Header().Set("X-Request-Id", id)

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

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// statusRecorder captures the status code written by the wrapped handler so
// RequestLogging can log it after the fact; net/http gives no other way to
// observe it.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(status int) {
	s.status = status
	s.ResponseWriter.WriteHeader(status)
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
