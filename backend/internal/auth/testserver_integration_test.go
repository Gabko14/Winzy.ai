//go:build integration

// Package auth_test's integration suite follows the recipe documented in
// internal/dbtest and the PM REVIEW ADDENDUM on winzy.ai-rdc7.1: point at
// the compose "winzy-db" service via TEST_DATABASE_URL, migrations +
// per-test truncation handled by dbtest.Connect. Run with:
//
//	docker compose up -d winzy-db
//	TEST_DATABASE_URL=postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable \
//	  go test -tags=integration -race -v ./internal/auth/...
package auth_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/httpserver"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
)

const testJWTSecret = "integration-test-secret-that-is-at-least-32-chars!!"

// newTestServer wires the same middleware stack cmd/api/main.go assembles
// (JWT auth, then rate limiting) around the auth module's routes, backed by
// a real Postgres via dbtest.Connect. Its rate limits are deliberately
// generous so ordinary tests never trip them; TestRateLimit_* builds its
// own tightly-limited server.
func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv, _, _ := newTestServerWithRegistries(t, 100000, 100000)
	return srv
}

// newTestServerWithRegistries is newTestServer plus access to the event and
// export registries, for tests that need to register their own handler
// (proving UserRegistered/UserDeleted actually fire) or export section.
func newTestServerWithRegistries(t *testing.T, authPerMinute, generalPerMinute int) (*httptest.Server, *events.Registry, *export.Registry) {
	t.Helper()
	pool := dbtest.Connect(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tokens, err := auth.NewTokenService(testJWTSecret, 15, 7)
	if err != nil {
		t.Fatalf("auth.NewTokenService() returned unexpected error: %v", err)
	}

	registry := events.New(logger)
	exportRegistry := export.New(logger)
	service := auth.NewService(pool, tokens, registry, exportRegistry, logger)
	handlers := auth.NewHandlers(service)

	mux := http.NewServeMux()
	auth.RegisterRoutes(mux, handlers)

	protected := auth.Middleware(tokens, auth.DefaultPublicRoutes())(mux)

	generalLimiter := ratelimit.New(generalPerMinute, time.Minute)
	authLimiter := ratelimit.New(authPerMinute, time.Minute)
	rateLimited := ratelimit.PrefixMiddleware(generalLimiter, authLimiter, "/auth/")(protected)

	// Wrapped through httpserver.New (not a bare httptest.NewServer(rateLimited))
	// so the test exercises the exact same middleware stack cmd/api/main.go
	// assembles — critically, RequestLogging, which installs the mutable
	// request-state box that httpserver.SetUserID/UserIDFromContext rely on.
	// An earlier version of this harness skipped it and every handler that
	// reads the authenticated user id silently saw an empty string.
	inner := httpserver.New(0, "http://localhost:8081", rateLimited, logger)

	srv := httptest.NewServer(inner.Handler)
	t.Cleanup(srv.Close)
	return srv, registry, exportRegistry
}

type testRequest struct {
	method  string
	path    string
	body    any
	headers map[string]string
}

func doRequest(t *testing.T, srv *httptest.Server, req testRequest) *http.Response {
	t.Helper()

	var bodyReader io.Reader
	if req.body != nil {
		b, err := json.Marshal(req.body)
		if err != nil {
			t.Fatalf("marshaling request body: %v", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	httpReq, err := http.NewRequest(req.method, srv.URL+req.path, bodyReader)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	if req.body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	for k, v := range req.headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatalf("executing request: %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func decodeBody[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("decoding response body: %v", err)
	}
	return v
}

// setCookieValue extracts the named cookie's value from a response's
// Set-Cookie header, or "" if absent.
func setCookieValue(resp *http.Response, name string) string {
	for _, c := range resp.Cookies() {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

// registerUser is the common "create a fresh user, return its
// AuthResponse" step nearly every test needs.
func registerUser(t *testing.T, srv *httptest.Server, email, username, password string, displayName *string) auth.AuthResponse {
	t.Helper()
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: email, Username: username, Password: password, DisplayName: displayName},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register(%s) status = %d, want 201", email, resp.StatusCode)
	}
	return decodeBody[auth.AuthResponse](t, resp)
}

func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}
