//go:build integration

package challenges_test

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
	"github.com/Gabko14/winzy/backend/internal/challenges"
	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
	"github.com/Gabko14/winzy/backend/internal/httpserver"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
	"github.com/Gabko14/winzy/backend/internal/social"
	"github.com/jackc/pgx/v5/pgxpool"
)

const testJWTSecret = "integration-test-secret-that-is-at-least-32-chars!!"

type testStack struct {
	srv               *httptest.Server
	pool              *pgxpool.Pool
	tokens            *auth.TokenService
	registry          *events.Registry
	exportReg         *export.Registry
	authService       *auth.Service
	habitsService     *habits.Service
	socialService     *social.Service
	challengesService *challenges.Service
}

func newTestStack(t *testing.T) testStack {
	t.Helper()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tokens, err := auth.NewTokenService(testJWTSecret, 15, 7)
	if err != nil {
		t.Fatalf("auth.NewTokenService: %v", err)
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

	challengesService := challenges.NewService(pool, registry, exportReg, authService, socialService, habitsService, logger, "http://localhost:8081")
	challengesHandlers := challenges.NewHandlers(challengesService)

	mux := http.NewServeMux()
	habits.RegisterRoutes(mux, habitsHandlers)
	social.RegisterRoutes(mux, socialHandlers)
	challenges.RegisterRoutes(mux, challengesHandlers)

	publicRoutes := map[string]bool{
		"GET /habits/public/*":      true,
		"GET /social/witness/*":     true,
		"GET /challenges/invites/*": true,
	}
	protected := auth.Middleware(tokens, publicRoutes)(mux)
	bodyLimited := httpserver.BodyLimit()(protected)
	generalLimiter := ratelimit.New(100000, time.Minute)
	authLimiter := ratelimit.New(100000, time.Minute)
	rateLimited := ratelimit.PrefixMiddleware(generalLimiter, authLimiter, "/auth/", false)(bodyLimited)

	inner := httpserver.New(0, "http://localhost:8081", rateLimited, logger)
	srv := httptest.NewServer(inner.Handler)
	t.Cleanup(srv.Close)

	return testStack{
		srv: srv, pool: pool, tokens: tokens, registry: registry, exportReg: exportReg,
		authService: authService, habitsService: habitsService,
		socialService: socialService, challengesService: challengesService,
	}
}

func bearerFor(t *testing.T, tokens *auth.TokenService, userID string) map[string]string {
	t.Helper()
	token, err := tokens.GenerateAccessToken(userID, userID+"@example.com")
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	return map[string]string{"Authorization": "Bearer " + token}
}

func registerUser(t *testing.T, authService *auth.Service, email, username string) auth.AuthResult {
	t.Helper()
	result, err := authService.Register(context.Background(), email, username, "Password123!", nil)
	if err != nil {
		t.Fatalf("Register(%s): %v", email, err)
	}
	return result
}

func createHabit(t *testing.T, stack testStack, userID, name string) string {
	t.Helper()
	h, err := stack.habitsService.CreateHabit(context.Background(), userID, habits.CreateHabitRequest{Name: name})
	if err != nil {
		t.Fatalf("CreateHabit: %v", err)
	}
	return h.ID
}

func makeFriends(t *testing.T, stack testStack, a, b string) {
	t.Helper()
	f, err := stack.socialService.SendFriendRequest(context.Background(), a, b)
	if err != nil {
		t.Fatalf("SendFriendRequest: %v", err)
	}
	if _, err := stack.socialService.AcceptFriendRequest(context.Background(), b, f.ID); err != nil {
		t.Fatalf("AcceptFriendRequest: %v", err)
	}
}

type testRequest struct {
	method  string
	path    string
	headers map[string]string
	body    any
}

func doRequest(t *testing.T, srv *httptest.Server, req testRequest) (int, map[string]any) {
	t.Helper()
	var bodyReader io.Reader
	if req.body != nil {
		switch v := req.body.(type) {
		case string:
			bodyReader = bytes.NewBufferString(v)
		case []byte:
			bodyReader = bytes.NewReader(v)
		default:
			raw, err := json.Marshal(v)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			bodyReader = bytes.NewReader(raw)
		}
	}
	httpReq, err := http.NewRequest(req.method, srv.URL+req.path, bodyReader)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if req.body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	for k, v := range req.headers {
		httpReq.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if len(raw) == 0 {
		return resp.StatusCode, nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal %q: %v", raw, err)
	}
	return resp.StatusCode, out
}
