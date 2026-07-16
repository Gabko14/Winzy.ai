package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// This file unit-tests isPublicRoute's exact-vs-prefix matching directly
// (no DB, no build tag) — middleware_integration_test.go already covers the
// token-validation branches (missing/garbage/expired/wrong-secret) against
// a real server, so this focuses on the "*"-suffix prefix convention added
// for winzy.ai-rdc7.3.3 (GET /habits/public/{username}).

func testTokenService(t *testing.T) *TokenService {
	t.Helper()
	tokens, err := NewTokenService("unit-test-secret-that-is-at-least-32-chars!!", 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}
	return tokens
}

func serveWithPublicRoutes(routes map[string]bool, method, path string) *httptest.ResponseRecorder {
	handler := Middleware(testTokenServiceForRecorder, routes)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// testTokenServiceForRecorder is a package-level TokenService so
// serveWithPublicRoutes doesn't need a *testing.T just to build one.
var testTokenServiceForRecorder = func() *TokenService {
	tokens, err := NewTokenService("unit-test-secret-that-is-at-least-32-chars-2!", 15, 7)
	if err != nil {
		panic(err)
	}
	return tokens
}()

func TestIsPublicRoute_HappyPath_ExactMatchBypassesAuth(t *testing.T) {
	t.Parallel()
	rec := serveWithPublicRoutes(map[string]bool{"POST /auth/register": true}, http.MethodPost, "/auth/register")
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 (exact public route)", rec.Code)
	}
}

func TestIsPublicRoute_HappyPath_PrefixMatchBypassesAuthForAnySuffix(t *testing.T) {
	t.Parallel()
	routes := map[string]bool{"GET /habits/public/*": true}
	for _, path := range []string{"/habits/public/alice", "/habits/public/alice/flame.svg", "/habits/public/"} {
		rec := serveWithPublicRoutes(routes, http.MethodGet, path)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s: status = %d, want 200 (prefix public route)", path, rec.Code)
		}
	}
}

func TestIsPublicRoute_EdgeCase_PrefixEntryDoesNotMatchADifferentMethod(t *testing.T) {
	t.Parallel()
	rec := serveWithPublicRoutes(map[string]bool{"GET /habits/public/*": true}, http.MethodPost, "/habits/public/alice")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("POST with a GET-only prefix entry: status = %d, want 401", rec.Code)
	}
}

func TestIsPublicRoute_EdgeCase_PrefixEntryDoesNotMatchAnUnrelatedPath(t *testing.T) {
	t.Parallel()
	rec := serveWithPublicRoutes(map[string]bool{"GET /habits/public/*": true}, http.MethodGet, "/habits/private/alice")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (path does not start with the public prefix)", rec.Code)
	}
}

func TestIsPublicRoute_EdgeCase_DisabledEntryIsNotPublic(t *testing.T) {
	t.Parallel()
	rec := serveWithPublicRoutes(map[string]bool{"GET /habits/public/*": false, "POST /auth/register": false}, http.MethodGet, "/habits/public/alice")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (a false-valued entry is present-but-disabled)", rec.Code)
	}
}

func TestMiddleware_HappyPath_ValidTokenAllowsProtectedRoute(t *testing.T) {
	t.Parallel()
	tokens := testTokenService(t)
	handler := Middleware(tokens, map[string]bool{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	token, err := tokens.GenerateAccessToken("11111111-1111-1111-1111-111111111111", "a@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/habits", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 (valid bearer token)", rec.Code)
	}
}

func TestMiddleware_ErrorCase_NoAuthorizationHeaderRejected(t *testing.T) {
	t.Parallel()
	tokens := testTokenService(t)
	handler := Middleware(tokens, map[string]bool{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/habits", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}

func TestMiddleware_ErrorCase_StrictJWTFailuresUseUnauthorizedShape(t *testing.T) {
	t.Parallel()
	const secret = "unit-test-secret-that-is-at-least-32-chars!!"
	tokens, err := NewTokenService(secret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}
	tests := []struct {
		name   string
		method jwt.SigningMethod
		claims jwt.MapClaims
	}{
		{name: "HS512", method: jwt.SigningMethodHS512, claims: jwt.MapClaims{"sub": "11111111-1111-1111-1111-111111111111", "exp": time.Now().Add(time.Minute).Unix()}},
		{name: "missing exp", method: jwt.SigningMethodHS256, claims: jwt.MapClaims{"sub": "11111111-1111-1111-1111-111111111111"}},
		{name: "garbage sub", method: jwt.SigningMethodHS256, claims: jwt.MapClaims{"sub": "garbage", "exp": time.Now().Add(time.Minute).Unix()}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := jwt.NewWithClaims(tt.method, tt.claims).SignedString([]byte(secret))
			if err != nil {
				t.Fatalf("signing token fixture: %v", err)
			}
			handler := Middleware(tokens, map[string]bool{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest(http.MethodGet, "/auth/profile", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized || rec.Body.String() != `{"error":"unauthorized"}` {
				t.Errorf("response = %d %q, want 401 unauthorized JSON", rec.Code, rec.Body.String())
			}
		})
	}
}
