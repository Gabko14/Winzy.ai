//go:build integration

// Package habits_test's integration suite follows the recipe documented in
// internal/dbtest and the PM REVIEW ADDENDUM on winzy.ai-rdc7.1: point at
// the compose "winzy-db" service via TEST_DATABASE_URL, migrations +
// per-test truncation handled by dbtest.Connect. Run with:
//
//	docker compose up -d winzy-db
//	TEST_DATABASE_URL=postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable \
//	  go test -tags=integration -race -v ./internal/habits/...
package habits_test

import (
	"bytes"
	"context"
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
	"github.com/Gabko14/winzy/backend/internal/habits"
	"github.com/Gabko14/winzy/backend/internal/httpserver"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
)

const testJWTSecret = "integration-test-secret-that-is-at-least-32-chars!!"

// newTestServer wires the same middleware stack cmd/api/main.go assembles
// (JWT auth, then rate limiting) around the habits module's routes, backed
// by a real Postgres via dbtest.Connect. habits.user_id/completions.user_id
// carry no foreign key to a users table (see migrations/0003_habits.up.sql's
// doc comment), so tests mint an access token directly via TokenService
// rather than registering a real user through /auth/register — the habits
// module genuinely does not care whether the id corresponds to an existing
// auth row. Tests that need a real registered user (the public flame
// surfaces, which resolve a username via auth.Service) use
// newTestServerWithAuth instead.
func newTestServer(t *testing.T) (*httptest.Server, *auth.TokenService, *events.Registry) {
	t.Helper()
	srv, tokens, registry, _, _ := newTestServerWithAuth(t)
	return srv, tokens, registry
}

// newTestServerWithAuth is newTestServer plus the auth.Service and
// export.Registry wired alongside habits, mirroring cmd/api/main.go's full
// wiring: habitsService.SetUsernameResolver(authService) is called before
// any request is served, and both services share the one export.Registry.
// promise_public_integration_test.go registers real users through authSvc
// directly (not over HTTP — auth's routes aren't mounted on this test
// server) so their usernames actually resolve; export_integration_test.go
// uses exportReg to assert the habits section's shape.
func newTestServerWithAuth(t *testing.T) (*httptest.Server, *auth.TokenService, *events.Registry, *auth.Service, *export.Registry) {
	t.Helper()
	pool := dbtest.Connect(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tokens, err := auth.NewTokenService(testJWTSecret, 15, 7)
	if err != nil {
		t.Fatalf("auth.NewTokenService() returned unexpected error: %v", err)
	}

	registry := events.New(logger)
	exportReg := export.New(logger)
	authService := auth.NewService(pool, tokens, registry, exportReg, logger)
	service := habits.NewService(pool, registry, exportReg, logger)
	service.SetUsernameResolver(authService)
	handlers := habits.NewHandlers(service)

	mux := http.NewServeMux()
	habits.RegisterRoutes(mux, handlers)

	// Every path requires a bearer token EXCEPT the public flame surfaces —
	// mirrors cmd/api/main.go's "GET /habits/public/*" prefix entry (see
	// auth.Middleware's isPublicRoute doc comment for the "*" convention).
	protected := auth.Middleware(tokens, map[string]bool{"GET /habits/public/*": true})(mux)
	bodyLimited := httpserver.BodyLimit()(protected)

	generalLimiter := ratelimit.New(100000, time.Minute)
	authLimiter := ratelimit.New(100000, time.Minute)
	rateLimited := ratelimit.PrefixMiddleware(generalLimiter, authLimiter, "/auth/", false)(bodyLimited)

	// Wrapped through httpserver.New (not a bare httptest.NewServer) so the
	// test exercises the same middleware stack cmd/api/main.go assembles —
	// see internal/auth/testserver_integration_test.go's identical note on
	// why this matters for httpserver.SetUserID/UserIDFromContext.
	inner := httpserver.New(0, "http://localhost:8081", rateLimited, logger)

	srv := httptest.NewServer(inner.Handler)
	t.Cleanup(srv.Close)
	return srv, tokens, registry, authService, exportReg
}

// bearerFor mints a valid access token for an arbitrary user id — no
// registered user is required (see newTestServer's doc comment).
func bearerFor(t *testing.T, tokens *auth.TokenService, userID string) map[string]string {
	t.Helper()
	token, err := tokens.GenerateAccessToken(userID, userID+"@example.com")
	if err != nil {
		t.Fatalf("generating access token: %v", err)
	}
	return map[string]string{"Authorization": "Bearer " + token}
}

// registerUserViaService creates a real user directly through authService
// (auth's own HTTP routes aren't mounted on this test server, so this calls
// its business logic in-process instead) — used by tests whose habit owner
// must be a resolvable username, i.e. the public flame surfaces
// (promise_public_integration_test.go).
func registerUserViaService(t *testing.T, authService *auth.Service, email, username string) auth.AuthResult {
	t.Helper()
	result, err := authService.Register(context.Background(), email, username, "Password123!", nil)
	if err != nil {
		t.Fatalf("Register(%s) returned unexpected error: %v", email, err)
	}
	return result
}

type testRequest struct {
	method string
	path   string
	body   any
	// rawBody, when non-empty, is sent verbatim instead of marshaling body
	// — needed for malformed-JSON tests, since json.Marshal validates its
	// own output and would refuse to produce genuinely invalid JSON.
	rawBody string
	headers map[string]string
}

func doRequest(t *testing.T, srv *httptest.Server, req testRequest) *http.Response {
	t.Helper()

	var bodyReader io.Reader
	hasBody := req.body != nil || req.rawBody != ""
	switch {
	case req.rawBody != "":
		bodyReader = bytes.NewReader([]byte(req.rawBody))
	case req.body != nil:
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
	if hasBody {
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

// createHabit is the common "create a habit, return its decoded response"
// step nearly every test needs.
func createHabit(t *testing.T, srv *httptest.Server, auth map[string]string, body any) habits.HabitResponse {
	t.Helper()
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits", body: body, headers: auth})
	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("createHabit status = %d, want 201; body: %s", resp.StatusCode, respBody)
	}
	return decodeBody[habits.HabitResponse](t, resp)
}
