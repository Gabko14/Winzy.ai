//go:build integration

package todos_test

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
	"github.com/Gabko14/winzy/backend/internal/httpserver"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
	"github.com/Gabko14/winzy/backend/internal/todos"
)

const testJWTSecret = "integration-test-secret-that-is-at-least-32-chars!!"

func newTestServer(t *testing.T) (*httptest.Server, *auth.TokenService, *events.Registry, *auth.Service, *export.Registry) {
	t.Helper()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tokens, err := auth.NewTokenService(testJWTSecret, 15, 7)
	if err != nil {
		t.Fatalf("auth.NewTokenService() returned unexpected error: %v", err)
	}

	registry := events.New(logger)
	exportReg := export.New(logger)
	authService := auth.NewService(pool, tokens, registry, exportReg, logger)
	service := todos.NewService(pool, registry, exportReg, logger)
	handlers := todos.NewHandlers(service)

	mux := http.NewServeMux()
	todos.RegisterRoutes(mux, handlers)
	auth.RegisterRoutes(mux, auth.NewHandlers(authService))

	protected := auth.Middleware(tokens, auth.DefaultPublicRoutes())(mux)
	bodyLimited := httpserver.BodyLimit()(protected)

	generalLimiter := ratelimit.New(100000, time.Minute)
	authLimiter := ratelimit.New(100000, time.Minute)
	rateLimited := ratelimit.PrefixMiddleware(generalLimiter, authLimiter, "/auth/", false)(bodyLimited)

	inner := httpserver.New(0, "http://localhost:8081", rateLimited, logger)
	srv := httptest.NewServer(inner.Handler)
	t.Cleanup(srv.Close)
	return srv, tokens, registry, authService, exportReg
}

func bearerFor(t *testing.T, tokens *auth.TokenService, userID string) map[string]string {
	t.Helper()
	token, err := tokens.GenerateAccessToken(userID, userID+"@example.com")
	if err != nil {
		t.Fatalf("generating access token: %v", err)
	}
	return map[string]string{"Authorization": "Bearer " + token}
}

func newUserID(t *testing.T, suffix string) string {
	t.Helper()
	return "00000000-0000-4000-8000-" + suffix
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

func createTodo(t *testing.T, srv *httptest.Server, auth map[string]string, body any) todos.TodoResponse {
	t.Helper()
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/todos", body: body, headers: auth})
	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("createTodo status = %d, want 201; body: %s", resp.StatusCode, respBody)
	}
	return decodeBody[todos.TodoResponse](t, resp)
}

func strPtr(s string) *string { return &s }
