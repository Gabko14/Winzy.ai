//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestChangePassword_HappyPath_WithCorrectCurrentReturnsNoContent(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "pw1@example.com", "pwuser1", "OldPassword1!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/password",
		headers: bearer(reg.AccessToken),
		body:    auth.ChangePasswordRequest{CurrentPassword: "OldPassword1!", NewPassword: "NewPassword1!"},
	})

	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

func TestChangePassword_HappyPath_CanLoginWithNewPassword(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "pw2@example.com", "pwuser2", "OldPassword1!", nil)

	changeResp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/password",
		headers: bearer(reg.AccessToken),
		body:    auth.ChangePasswordRequest{CurrentPassword: "OldPassword1!", NewPassword: "NewPassword1!"},
	})
	if changeResp.StatusCode != http.StatusNoContent {
		t.Fatalf("change-password status = %d, want 204", changeResp.StatusCode)
	}

	loginResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "pw2@example.com", Password: "NewPassword1!"},
	})
	if loginResp.StatusCode != http.StatusOK {
		t.Errorf("login with new password: status = %d, want 200", loginResp.StatusCode)
	}
}

func TestChangePassword_HappyPath_OldPasswordNoLongerWorks(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "pw3@example.com", "pwuser3", "OldPassword1!", nil)

	doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/password",
		headers: bearer(reg.AccessToken),
		body:    auth.ChangePasswordRequest{CurrentPassword: "OldPassword1!", NewPassword: "NewPassword1!"},
	})

	loginResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/login",
		body:   auth.LoginRequest{EmailOrUsername: "pw3@example.com", Password: "OldPassword1!"},
	})
	if loginResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("login with old password after change: status = %d, want 401", loginResp.StatusCode)
	}
}

func TestChangePassword_HappyPath_RevokesAllRefreshTokens(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "pw5@example.com", "pwuser5", "Password123!", nil)

	changeResp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/password",
		headers: bearer(reg.AccessToken),
		body:    auth.ChangePasswordRequest{CurrentPassword: "Password123!", NewPassword: "NewPassword1!"},
	})
	if changeResp.StatusCode != http.StatusNoContent {
		t.Fatalf("change-password status = %d, want 204", changeResp.StatusCode)
	}

	refreshResp := doRequest(t, srv, testRequest{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   auth.RefreshRequestBody{RefreshToken: reg.RefreshToken},
	})
	if refreshResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("refreshing the pre-password-change token: status = %d, want 401", refreshResp.StatusCode)
	}
}

func TestChangePassword_ErrorCase_WrongCurrentPasswordReturnsValidationError(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "pw4@example.com", "pwuser4", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/password",
		headers: bearer(reg.AccessToken),
		body:    auth.ChangePasswordRequest{CurrentPassword: "WrongPassword!", NewPassword: "NewPassword1!"},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]map[string][]string](t, resp)
	if len(body["errors"]["currentPassword"]) == 0 {
		t.Errorf(`body = %v, want a non-empty "errors.currentPassword"`, body)
	}
}

func TestChangePassword_ErrorCase_WithoutAuthReturnsUnauthorized(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut,
		path:   "/auth/password",
		body:   auth.ChangePasswordRequest{CurrentPassword: "old", NewPassword: "newpassword1!"},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestChangePassword_ErrorCase_TooShortNewPasswordReturnsValidationError(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "pw6@example.com", "pwuser6", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/password",
		headers: bearer(reg.AccessToken),
		body:    auth.ChangePasswordRequest{CurrentPassword: "Password123!", NewPassword: "short"},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
