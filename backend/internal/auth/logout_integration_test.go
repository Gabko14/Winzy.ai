//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestLogout_HappyPath_WithValidSessionReturnsNoContent(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "logout1@example.com", "logoutuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/logout",
		headers: mergeHeaders(bearer(reg.AccessToken), map[string]string{
			"Cookie": "refresh_token=" + *reg.RefreshToken,
		}),
	})

	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

func TestLogout_HappyPath_InvalidatesRefreshToken(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "logout2@example.com", "logoutuser2", "Password123!", nil)

	logoutResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/logout",
		headers: mergeHeaders(bearer(reg.AccessToken), map[string]string{
			"Cookie": "refresh_token=" + *reg.RefreshToken,
		}),
	})
	if logoutResp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204", logoutResp.StatusCode)
	}

	refreshResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: reg.RefreshToken},
	})
	if refreshResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("refreshing a logged-out token: status = %d, want 401", refreshResp.StatusCode)
	}
}

func TestLogout_ErrorCase_WithoutAuthReturnsUnauthorized(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/logout",
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func mergeHeaders(maps ...map[string]string) map[string]string {
	merged := map[string]string{}
	for _, m := range maps {
		for k, v := range m {
			merged[k] = v
		}
	}
	return merged
}
