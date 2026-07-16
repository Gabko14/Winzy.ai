//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestLogout_HappyPath_WithValidSessionReturnsNoContent(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/logout",
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestLogout_EdgeCase_LiteralNullBodyIsOptional(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "logoutnull@example.com", "logoutnull", "Password123!", nil)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/auth/logout", headers: bearer(reg.AccessToken), rawBody: rawBody("null"),
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

// TestLogout_EdgeCase_ChunkedEmptyBodyIsOptional closes FIX C (winzy.ai-n5fv
// review round 1): see the identical note on
// TestRefresh_EdgeCase_ChunkedEmptyBodyIsOptionalButHasNoToken — a zero-byte
// chunked logout body must still 204, not 400.
func TestLogout_EdgeCase_ChunkedEmptyBodyIsOptional(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "logoutchunked@example.com", "logoutchunked", "Password123!", nil)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/auth/logout", headers: bearer(reg.AccessToken), chunkedEmptyBody: true,
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

func TestLogout_ErrorCase_MalformedBodyIsNotIgnored(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "logoutbad@example.com", "logoutbad", "Password123!", nil)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/auth/logout", headers: bearer(reg.AccessToken), rawBody: rawBody(`{} trailing`),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
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
