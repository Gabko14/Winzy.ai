package auth

import (
	"net/http"
	"strings"

	"github.com/Gabko14/winzy/backend/internal/httpserver"
)

// publicRoutes lists the exact "METHOD path" pairs that skip JWT
// validation — the epic's public-route allowlist, restricted to the slice
// this module owns (POST /auth/register|login|refresh). Later module beads
// (GET /habits/public/**, GET /social/witness/{token}, GET
// /notifications/vapid-public-key) extend the allowlist Middleware is
// constructed with; see cmd/api/main.go for how the full list is
// assembled.
func defaultPublicRoutes() map[string]bool {
	return map[string]bool{
		"POST /auth/register": true,
		"POST /auth/login":    true,
		"POST /auth/refresh":  true,
	}
}

// Middleware validates the "Authorization: Bearer <token>" header on every
// request whose "METHOD path" is not in publicRoutes, rejecting missing,
// malformed, invalid, or expired tokens with 401. On success it stores the
// authenticated user id via httpserver.SetUserID — not a private
// context.WithValue, per the PM REVIEW on winzy.ai-rdc7.1: an inner
// context.WithValue would be invisible to the outer RequestLogging
// middleware that also needs user_id. Handlers recover it the same way, via
// httpserver.UserIDFromContext, so this module needs no additional
// context-key plumbing of its own.
func Middleware(tokens *TokenService, publicRoutes map[string]bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if publicRoutes[r.Method+" "+r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}

			header := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(header, "Bearer ")
			if !ok || token == "" {
				writeUnauthorized(w)
				return
			}

			userID, err := tokens.ValidateAccessToken(token)
			if err != nil {
				writeUnauthorized(w)
				return
			}

			httpserver.SetUserID(r.Context(), userID)
			next.ServeHTTP(w, r)
		})
	}
}

// DefaultPublicRoutes exposes this module's slice of the public-route
// allowlist so cmd/api/main.go can merge it with later modules' own public
// routes into the one map passed to Middleware.
func DefaultPublicRoutes() map[string]bool {
	return defaultPublicRoutes()
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
}
