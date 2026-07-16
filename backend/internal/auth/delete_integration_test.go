//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestDeleteAccount_HappyPath_ReturnsNoContent(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "delete1@example.com", "deleteuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})

	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

func TestDeleteAccount_HappyPath_CannotLoginAfterwards(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "delete2@example.com", "deleteuser2", "Password123!", nil)

	deleteResp := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})
	if deleteResp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", deleteResp.StatusCode)
	}

	loginResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "delete2@example.com", Password: "Password123!"},
	})
	if loginResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("login after account delete: status = %d, want 401", loginResp.StatusCode)
	}
}

func TestDeleteAccount_ErrorCase_WithoutAuthReturnsUnauthorized(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/auth/account"})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestDeleteAccount_ErrorCase_DoubleDeleteReturnsNotFound(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "delete3@example.com", "deleteuser3", "Password123!", nil)

	first := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})
	if first.StatusCode != http.StatusNoContent {
		t.Fatalf("first delete status = %d, want 204", first.StatusCode)
	}

	second := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})
	if second.StatusCode != http.StatusNotFound {
		t.Errorf("second delete (same still-valid JWT): status = %d, want 404", second.StatusCode)
	}
}
