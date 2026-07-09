//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestRegister_HappyPath_ReturnsCreatedWithTokensAndProfile(t *testing.T) {
	srv := newTestServer(t)
	displayName := "Test User"

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body: auth.RegisterRequest{
			Email: "register1@example.com", Username: "register1",
			Password: "Password123!", DisplayName: &displayName,
		},
	})

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}

	body := decodeBody[auth.AuthResponse](t, resp)
	if body.AccessToken == "" {
		t.Error("AccessToken is empty")
	}
	if body.RefreshToken == nil || *body.RefreshToken == "" {
		t.Error("RefreshToken should be present in the body for a native (non-web) request")
	}
	if body.User.Email != "register1@example.com" {
		t.Errorf("User.Email = %q, want register1@example.com", body.User.Email)
	}
	if body.User.Username != "register1" {
		t.Errorf("User.Username = %q, want register1", body.User.Username)
	}
	if body.User.DisplayName == nil || *body.User.DisplayName != "Test User" {
		t.Errorf("User.DisplayName = %v, want Test User", body.User.DisplayName)
	}
}

func TestRegister_HappyPath_SetsRefreshTokenCookie(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "cookie1@example.com", Username: "cookie1", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}

	found := false
	for _, c := range resp.Cookies() {
		if c.Name == "refresh_token" {
			found = true
			if !c.HttpOnly {
				t.Error("refresh_token cookie must be HttpOnly")
			}
			if c.SameSite != http.SameSiteStrictMode {
				t.Errorf("refresh_token cookie SameSite = %v, want Strict", c.SameSite)
			}
		}
	}
	if !found {
		t.Error("response did not set a refresh_token cookie")
	}
}

func TestRegister_HappyPath_WebClientOmitsRefreshTokenFromBody(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPost,
		path:    "/auth/register",
		body:    auth.RegisterRequest{Email: "webclient1@example.com", Username: "webclient1", Password: "Password123!"},
		headers: map[string]string{"Sec-Fetch-Site": "same-origin"},
	})

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}

	body := decodeBody[auth.AuthResponse](t, resp)
	if body.RefreshToken != nil {
		t.Error("a web client (Sec-Fetch-Site present) must receive a null refreshToken in the body")
	}
	if setCookieValue(resp, "refresh_token") == "" {
		t.Error("a web client must still receive the refresh token via cookie")
	}
}

func TestRegister_EdgeCase_NormalizesEmailAndUsername(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "  NormTest@Example.COM  ", Username: "NormUser1", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[auth.AuthResponse](t, resp)
	if body.User.Email != "normtest@example.com" {
		t.Errorf("User.Email = %q, want normtest@example.com", body.User.Email)
	}
	if body.User.Username != "normuser1" {
		t.Errorf("User.Username = %q, want normuser1", body.User.Username)
	}
}

func TestRegister_EdgeCase_WithoutDisplayNameIsNull(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "noname1@example.com", Username: "noname1", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[auth.AuthResponse](t, resp)
	if body.User.DisplayName != nil {
		t.Errorf("User.DisplayName = %v, want nil", body.User.DisplayName)
	}
}

func TestRegister_ErrorCase_DuplicateEmailReturnsConflict(t *testing.T) {
	srv := newTestServer(t)
	registerUser(t, srv, "dup1@example.com", "dupuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "dup1@example.com", Username: "dupuser2", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusConflict {
		t.Errorf("status = %d, want 409", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] == "" {
		t.Error(`409 response body should have a non-empty "error" field`)
	}
}

func TestRegister_ErrorCase_DuplicateUsernameReturnsConflict(t *testing.T) {
	srv := newTestServer(t)
	registerUser(t, srv, "unique1@example.com", "sameuser", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "unique2@example.com", Username: "sameuser", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusConflict {
		t.Errorf("status = %d, want 409", resp.StatusCode)
	}
}

func TestRegister_ErrorCase_InvalidEmailReturnsValidationErrors(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "not-an-email", Username: "validuser1", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (see bead report's deviation note: actual .NET ValidationProblem is 400, not 422)", resp.StatusCode)
	}
	body := decodeBody[map[string]map[string][]string](t, resp)
	if len(body["errors"]["email"]) == 0 {
		t.Errorf(`body = %v, want a non-empty "errors.email"`, body)
	}
}

func TestRegister_ErrorCase_InvalidUsernameReturnsValidationErrors(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "valid@example.com", Username: "ab", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestRegister_ErrorCase_ShortPasswordReturnsValidationErrors(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/register",
		body:   auth.RegisterRequest{Email: "short@example.com", Username: "shortpw1", Password: "short"},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
