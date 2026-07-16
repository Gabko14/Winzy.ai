//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestRefresh_HappyPath_ValidTokenReturnsNewRotatedTokens(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "refresh1@example.com", "refreshuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: reg.RefreshToken},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[auth.AuthResponse](t, resp)
	if body.AccessToken == "" {
		t.Error("AccessToken is empty")
	}
	if body.RefreshToken == nil || *body.RefreshToken == "" {
		t.Fatal("RefreshToken should be present for a native request")
	}
	if *body.RefreshToken == *reg.RefreshToken {
		t.Error("Refresh() must rotate to a new refresh token, got the same one back")
	}
}

func TestRefresh_HappyPath_SetsNewCookie(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "refresh3@example.com", "refreshuser3", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: reg.RefreshToken},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if setCookieValue(resp, "refresh_token") == "" {
		t.Error("refresh response did not set a refresh_token cookie")
	}
}

func TestRefresh_HappyPath_ViaCookieForWebClients(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "refreshweb1@example.com", "refreshwebuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		headers: map[string]string{
			"Cookie": "refresh_token=" + *reg.RefreshToken,
		},
		body: auth.RefreshRequestBody{}, // no body token: must fall back to the cookie
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (cookie-based refresh should work with no body token)", resp.StatusCode)
	}
}

func TestRefresh_ErrorCase_RevokedTokenReturnsUnauthorized(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "refresh2@example.com", "refreshuser2", "Password123!", nil)
	original := reg.RefreshToken

	first := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: original},
	})
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first refresh status = %d, want 200", first.StatusCode)
	}

	second := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: original},
	})
	if second.StatusCode != http.StatusUnauthorized {
		t.Errorf("reusing an already-rotated refresh token: status = %d, want 401", second.StatusCode)
	}
}

func TestRefresh_ErrorCase_InvalidTokenReturnsUnauthorized(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	garbage := "completely-invalid-token"

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: &garbage},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestRefresh_ErrorCase_NoTokenReturnsUnauthorized(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: nil},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestRefresh_EdgeCase_LiteralNullBodyIsOptionalButHasNoToken(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/auth/refresh", rawBody: rawBody("null")})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestRefresh_EdgeCase_MissingBodyIsOptionalButHasNoToken(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/auth/refresh"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

// TestRefresh_EdgeCase_ChunkedEmptyBodyIsOptionalButHasNoToken closes FIX C
// (winzy.ai-n5fv review round 1): a zero-byte CHUNKED body has
// r.ContentLength == -1, not 0, so decodeOptionalJSON must not use
// ContentLength to decide emptiness — otherwise this 400s as malformed
// instead of hitting the nullable-body path and 401ing for lack of a token.
func TestRefresh_EdgeCase_ChunkedEmptyBodyIsOptionalButHasNoToken(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/auth/refresh", chunkedEmptyBody: true})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestRefresh_ErrorCase_TrailingJSONReturnsBadRequest(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/auth/refresh", rawBody: rawBody(`{} trailing`)})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
