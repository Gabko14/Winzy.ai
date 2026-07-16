//go:build integration

package auth_test

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/events"
)

func TestMiddleware_HappyPath_PublicRoutesWorkWithoutAuthorizationHeader(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "public1@example.com", Username: "publicuser1", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusCreated {
		t.Errorf("POST /auth/register without Authorization: status = %d, want 201 (it is on the public allowlist)", resp.StatusCode)
	}
}

func TestMiddleware_ErrorCase_MissingTokenRejectsProtectedRoute(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/auth/profile"})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("GET /auth/profile with no Authorization header: status = %d, want 401", resp.StatusCode)
	}
}

func TestMiddleware_ErrorCase_GarbageTokenRejected(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/profile",
		headers: map[string]string{"Authorization": "Bearer not-a-real-jwt"},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("garbage bearer token: status = %d, want 401", resp.StatusCode)
	}
}

func TestMiddleware_ErrorCase_MalformedAuthorizationHeaderRejected(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/profile",
		headers: map[string]string{"Authorization": "not-even-bearer-scheme"},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("non-Bearer Authorization header: status = %d, want 401", resp.StatusCode)
	}
}

func TestMiddleware_ErrorCase_ExpiredTokenRejected(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	// A TokenService with a 0-minute access lifetime issues already-expired
	// tokens, letting this test exercise expiry without sleeping.
	expiredTokens, err := auth.NewTokenService(testJWTSecret, 0, 7)
	if err != nil {
		t.Fatalf("auth.NewTokenService() returned unexpected error: %v", err)
	}
	expiredToken, err := expiredTokens.GenerateAccessToken("00000000-0000-0000-0000-000000000000", "expired@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}
	time.Sleep(10 * time.Millisecond)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/profile",
		headers: bearer(expiredToken),
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expired token: status = %d, want 401", resp.StatusCode)
	}
}

func TestMiddleware_ErrorCase_TokenSignedWithDifferentSecretRejected(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	otherTokens, err := auth.NewTokenService("a-completely-different-secret-value-32ch", 15, 7)
	if err != nil {
		t.Fatalf("auth.NewTokenService() returned unexpected error: %v", err)
	}
	foreignToken, err := otherTokens.GenerateAccessToken("00000000-0000-0000-0000-000000000000", "foreign@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/profile",
		headers: bearer(foreignToken),
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("token signed with a different secret: status = %d, want 401", resp.StatusCode)
	}
}

func TestRateLimit_HappyPath_AuthEndpointAllowsUpToLimit(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServerWithRegistries(t, 2, 100000)

	for i := 0; i < 2; i++ {
		resp := doRequest(t, srv, testRequest{
			method: http.MethodPost,
			path:   "/auth/login",
			body:   auth.LoginRequest{EmailOrUsername: "nobody@example.com", Password: "wrong"},
		})
		if resp.StatusCode == http.StatusTooManyRequests {
			t.Fatalf("request %d of 2 (within the auth limit) was rate-limited", i+1)
		}
	}
}

func TestRateLimit_ErrorCase_AuthEndpointRejectsOverLimit(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServerWithRegistries(t, 2, 100000)

	for i := 0; i < 2; i++ {
		doRequest(t, srv, testRequest{
			method: http.MethodPost,
			path:   "/auth/login",
			body:   auth.LoginRequest{EmailOrUsername: "nobody@example.com", Password: "wrong"},
		})
	}

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "nobody@example.com", Password: "wrong"},
	})
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("3rd /auth/login request over a limit of 2: status = %d, want 429", resp.StatusCode)
	}
}

func TestRateLimit_ErrorCase_GeneralLimitAppliesToNonAuthPaths(t *testing.T) {
	t.Parallel()
	// /auth/profile is itself under the auth prefix; use the general
	// limiter's effect on a non-auth-prefixed request by hitting it via a
	// tiny general limit while the auth limit stays generous — /auth/*
	// paths are excluded from the general limiter by design, so this test
	// confirms the auth prefix match itself, not a false shared bucket.
	srv, _, _ := newTestServerWithRegistries(t, 100000, 1)

	first := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/health"})
	if first.StatusCode == http.StatusTooManyRequests {
		t.Fatal("first /health request should be allowed under a general limit of 1")
	}

	second := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/health"})
	if second.StatusCode != http.StatusTooManyRequests {
		t.Errorf("second /health request over a general limit of 1: status = %d, want 429", second.StatusCode)
	}
}

func TestEvents_HappyPath_RegisterEmitsUserRegistered(t *testing.T) {
	t.Parallel()
	srv, registry, _ := newTestServerWithRegistries(t, 100000, 100000)

	var mu sync.Mutex
	var received *events.UserRegistered
	events.Register(registry, events.Handler[events.UserRegistered](func(_ context.Context, e events.UserRegistered) error {
		mu.Lock()
		defer mu.Unlock()
		received = &e
		return nil
	}))

	reg := registerUser(t, srv, "eventreg1@example.com", "eventreguser1", "Password123!", nil)

	mu.Lock()
	defer mu.Unlock()
	if received == nil {
		t.Fatal("UserRegistered handler was never called")
	}
	if received.UserID != reg.User.ID {
		t.Errorf("UserRegistered.UserID = %q, want %q", received.UserID, reg.User.ID)
	}
	if received.Username != "eventreguser1" {
		t.Errorf("UserRegistered.Username = %q, want eventreguser1", received.Username)
	}
}

func TestEvents_HappyPath_DeleteAccountEmitsUserDeleted(t *testing.T) {
	t.Parallel()
	srv, registry, _ := newTestServerWithRegistries(t, 100000, 100000)

	var mu sync.Mutex
	var received *events.UserDeleted
	events.Register(registry, events.Handler[events.UserDeleted](func(_ context.Context, e events.UserDeleted) error {
		mu.Lock()
		defer mu.Unlock()
		received = &e
		return nil
	}))

	reg := registerUser(t, srv, "eventdel1@example.com", "eventdeluser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", resp.StatusCode)
	}

	mu.Lock()
	defer mu.Unlock()
	if received == nil {
		t.Fatal("UserDeleted handler was never called")
	}
	if received.UserID != reg.User.ID {
		t.Errorf("UserDeleted.UserID = %q, want %q", received.UserID, reg.User.ID)
	}
}

func TestEvents_ErrorCase_FailingUserDeletedHandlerRollsBackDelete(t *testing.T) {
	t.Parallel()
	srv, registry, _ := newTestServerWithRegistries(t, 100000, 100000)

	events.Register(registry, events.Handler[events.UserDeleted](func(_ context.Context, _ events.UserDeleted) error {
		return context.DeadlineExceeded // any non-nil error
	}))

	reg := registerUser(t, srv, "eventdelfail1@example.com", "eventdelfailuser1", "Password123!", nil)

	deleteResp := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})
	if deleteResp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("delete with a failing handler: status = %d, want 500", deleteResp.StatusCode)
	}

	// The transaction must have rolled back: the user can still log in.
	loginResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "eventdelfail1@example.com", Password: "Password123!"},
	})
	if loginResp.StatusCode != http.StatusOK {
		t.Errorf("login after a rolled-back delete: status = %d, want 200 (the user row must still exist)", loginResp.StatusCode)
	}
}
