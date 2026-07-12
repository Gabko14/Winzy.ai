//go:build integration

// Package social_test's integration suite follows the recipe documented in
// internal/dbtest and internal/habits' own testserver_integration_test.go:
// point at the compose "winzy-db" service via TEST_DATABASE_URL, migrations
// + per-test truncation handled by dbtest.Connect. Run with:
//
//	docker compose up -d winzy-db
//	TEST_DATABASE_URL=postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable \
//	  go test -tags=integration -race -v ./internal/social/...
package social_test

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
	"github.com/Gabko14/winzy/backend/internal/social"
)

const testJWTSecret = "integration-test-secret-that-is-at-least-32-chars!!"

// testStack bundles every piece a social integration test might need,
// mirroring cmd/api/main.go's wiring exactly (including the
// habitsService.SetVisibilityFilter(socialService) wiring the public-page
// filtering tests in cross_integration_test.go depend on).
type testStack struct {
	srv           *httptest.Server
	tokens        *auth.TokenService
	registry      *events.Registry
	exportReg     *export.Registry
	authService   *auth.Service
	habitsService *habits.Service
	socialService *social.Service
}

func newTestStack(t *testing.T) testStack {
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

	habitsService := habits.NewService(pool, registry, exportReg, logger)
	habitsService.SetUsernameResolver(authService)
	habitsHandlers := habits.NewHandlers(habitsService)

	socialService := social.NewService(pool, registry, exportReg, authService, habitsService, logger)
	habitsService.SetVisibilityFilter(socialService)
	socialHandlers := social.NewHandlers(socialService)

	mux := http.NewServeMux()
	habits.RegisterRoutes(mux, habitsHandlers)
	social.RegisterRoutes(mux, socialHandlers)

	// Every path requires a bearer token EXCEPT the public flame surfaces and
	// the witness link viewer — mirrors cmd/api/main.go's allowlist.
	publicRoutes := map[string]bool{
		"GET /habits/public/*":  true,
		"GET /social/witness/*": true,
	}
	protected := auth.Middleware(tokens, publicRoutes)(mux)

	generalLimiter := ratelimit.New(100000, time.Minute)
	authLimiter := ratelimit.New(100000, time.Minute)
	rateLimited := ratelimit.PrefixMiddleware(generalLimiter, authLimiter, "/auth/")(protected)

	inner := httpserver.New(0, "http://localhost:8081", rateLimited, logger)
	srv := httptest.NewServer(inner.Handler)
	t.Cleanup(srv.Close)

	return testStack{
		srv: srv, tokens: tokens, registry: registry, exportReg: exportReg,
		authService: authService, habitsService: habitsService, socialService: socialService,
	}
}

// bearerFor mints a valid access token for an arbitrary user id — no
// registered user is required, matching habits' identical helper.
func bearerFor(t *testing.T, tokens *auth.TokenService, userID string) map[string]string {
	t.Helper()
	token, err := tokens.GenerateAccessToken(userID, userID+"@example.com")
	if err != nil {
		t.Fatalf("generating access token: %v", err)
	}
	return map[string]string{"Authorization": "Bearer " + token}
}

func registerUserViaService(t *testing.T, authService *auth.Service, email, username string) auth.AuthResult {
	t.Helper()
	result, err := authService.Register(context.Background(), email, username, "Password123!", nil)
	if err != nil {
		t.Fatalf("Register(%s) returned unexpected error: %v", email, err)
	}
	return result
}

type testRequest struct {
	method  string
	path    string
	body    any
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

// createHabit is the common "create a habit via the habits module, return
// its decoded response" step several cross-module tests need.
func createHabit(t *testing.T, srv *httptest.Server, a map[string]string, body any) habits.HabitResponse {
	t.Helper()
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits", body: body, headers: a})
	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("createHabit status = %d, want 201; body: %s", resp.StatusCode, respBody)
	}
	return decodeBody[habits.HabitResponse](t, resp)
}
