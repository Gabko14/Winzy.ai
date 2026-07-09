//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestLogin_HappyPath_WithEmailReturnsOK(t *testing.T) {
	srv := newTestServer(t)
	registerUser(t, srv, "login1@example.com", "loginuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "login1@example.com", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[auth.AuthResponse](t, resp)
	if body.AccessToken == "" || body.RefreshToken == nil {
		t.Errorf("body = %+v, want non-empty AccessToken and non-nil RefreshToken", body)
	}
	if body.User.Email != "login1@example.com" {
		t.Errorf("User.Email = %q, want login1@example.com", body.User.Email)
	}
}

func TestLogin_HappyPath_WithUsernameReturnsOK(t *testing.T) {
	srv := newTestServer(t)
	registerUser(t, srv, "login2@example.com", "loginuser2", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "loginuser2", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[auth.AuthResponse](t, resp)
	if body.User.Username != "loginuser2" {
		t.Errorf("User.Username = %q, want loginuser2", body.User.Username)
	}
}

func TestLogin_HappyPath_IsCaseInsensitive(t *testing.T) {
	srv := newTestServer(t)
	registerUser(t, srv, "CaseTest@Example.COM", "caseuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "casetest@example.com", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestLogin_HappyPath_SetsRefreshTokenCookie(t *testing.T) {
	srv := newTestServer(t)
	registerUser(t, srv, "login4@example.com", "loginuser4", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "login4@example.com", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if setCookieValue(resp, "refresh_token") == "" {
		t.Error("login response did not set a refresh_token cookie")
	}
}

func TestLogin_HappyPath_UpdatesLastLoginAt(t *testing.T) {
	// UserProfile (the /auth/profile response shape) does not expose
	// LastLoginAt — but the export section does, so that's what this test
	// (per the PM REVIEW ADDENDUM: "Login updates User.LastLoginAt... easy
	// to drop silently - test it") checks it through.
	srv := newTestServer(t)
	registerUser(t, srv, "lastlogin1@example.com", "lastloginuser1", "Password123!", nil)

	loginResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "lastlogin1@example.com", Password: "Password123!"},
	})
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d, want 200", loginResp.StatusCode)
	}
	loginBody := decodeBody[auth.AuthResponse](t, loginResp)

	exportResp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/export",
		headers: bearer(loginBody.AccessToken),
	})
	if exportResp.StatusCode != http.StatusOK {
		t.Fatalf("export status = %d, want 200", exportResp.StatusCode)
	}

	type exportBody struct {
		Services []struct {
			Service string         `json:"service"`
			Data    map[string]any `json:"data"`
		} `json:"services"`
	}
	body := decodeBody[exportBody](t, exportResp)
	if len(body.Services) != 1 || body.Services[0].Service != "auth" {
		t.Fatalf("services = %+v, want exactly one auth section", body.Services)
	}
	if body.Services[0].Data["lastLoginAt"] == nil {
		t.Error("export's auth section lastLoginAt is null after a successful login — LastLoginAt was not updated")
	}
}

func TestLogin_ErrorCase_WrongPasswordReturnsUnauthorized(t *testing.T) {
	srv := newTestServer(t)
	registerUser(t, srv, "login3@example.com", "loginuser3", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "login3@example.com", Password: "WrongPassword!"},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestLogin_ErrorCase_NonexistentUserReturnsUnauthorized(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "nonexistent@example.com", Password: "Password123!"},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestLogin_ErrorCase_MissingFieldsReturnsBadRequest(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "", Password: ""},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
