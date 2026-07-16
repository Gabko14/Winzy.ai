//go:build integration

package auth_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestGetProfile_HappyPath_ReturnsUserProfile(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	displayName := "My Name"
	reg := registerUser(t, srv, "profile1@example.com", "profileuser1", "Password123!", &displayName)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/profile",
		headers: bearer(reg.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	profile := decodeBody[auth.UserProfile](t, resp)
	if profile.Email != "profile1@example.com" {
		t.Errorf("Email = %q, want profile1@example.com", profile.Email)
	}
	if profile.Username != "profileuser1" {
		t.Errorf("Username = %q, want profileuser1", profile.Username)
	}
	if profile.DisplayName == nil || *profile.DisplayName != "My Name" {
		t.Errorf("DisplayName = %v, want My Name", profile.DisplayName)
	}
}

func TestGetProfile_ErrorCase_WithoutAuthReturnsUnauthorized(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/auth/profile"})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestGetProfile_ErrorCase_AfterAccountDeletedReturnsNotFound(t *testing.T) {
	t.Parallel()
	// A valid JWT for a user deleted after the token was issued: the
	// middleware still accepts the (unexpired) token, but GetProfile must
	// 404 since the row is gone.
	srv := newTestServer(t)
	reg := registerUser(t, srv, "profilegone1@example.com", "profilegoneuser1", "Password123!", nil)

	deleteResp := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})
	if deleteResp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete-account status = %d, want 204", deleteResp.StatusCode)
	}

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/profile",
		headers: bearer(reg.AccessToken),
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateProfile_HappyPath_ChangesDisplayName(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	oldName := "Old Name"
	reg := registerUser(t, srv, "profile2@example.com", "profileuser2", "Password123!", &oldName)

	newName := "New Name"
	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/profile",
		headers: bearer(reg.AccessToken),
		body:    auth.UpdateProfileRequest{DisplayName: &newName},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	profile := decodeBody[auth.UserProfile](t, resp)
	if profile.DisplayName == nil || *profile.DisplayName != "New Name" {
		t.Errorf("DisplayName = %v, want New Name", profile.DisplayName)
	}
}

func TestUpdateProfile_EdgeCase_BlankDisplayNameClearsIt(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	oldName := "Old Name"
	reg := registerUser(t, srv, "profileclear1@example.com", "profileclearuser1", "Password123!", &oldName)

	blank := "   "
	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/profile",
		headers: bearer(reg.AccessToken),
		body:    auth.UpdateProfileRequest{DisplayName: &blank},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	profile := decodeBody[auth.UserProfile](t, resp)
	if profile.DisplayName != nil {
		t.Errorf("DisplayName = %v, want nil after a blank update", profile.DisplayName)
	}
}

func TestUpdateProfile_EdgeCase_ValidAvatarURLAccepted(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar1@example.com", "avataruser1", "Password123!", nil)

	url := "https://example.com/avatar.png"
	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/profile",
		headers: bearer(reg.AccessToken),
		body:    auth.UpdateProfileRequest{AvatarURL: &url},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	profile := decodeBody[auth.UserProfile](t, resp)
	if profile.AvatarURL == nil || *profile.AvatarURL != url {
		t.Errorf("AvatarURL = %v, want %s", profile.AvatarURL, url)
	}
}

func TestUpdateProfile_ErrorCase_InvalidAvatarURLReturnsValidationError(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "avatar2@example.com", "avataruser2", "Password123!", nil)

	invalid := "not a url"
	resp := doRequest(t, srv, testRequest{
		method:  http.MethodPut,
		path:    "/auth/profile",
		headers: bearer(reg.AccessToken),
		body:    auth.UpdateProfileRequest{AvatarURL: &invalid},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]map[string][]string](t, resp)
	if len(body["errors"]["avatarUrl"]) == 0 {
		t.Errorf(`body = %v, want a non-empty "errors.avatarUrl"`, body)
	}
}

func TestUpdateProfile_ErrorCase_WithoutAuthReturnsUnauthorized(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	name := "Name"

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut,
		path:   "/auth/profile",
		body:   auth.UpdateProfileRequest{DisplayName: &name},
	})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestUpdateProfile_ErrorCase_LiteralNullBodyIsRequired(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "profilenull@example.com", "profilenull", "Password123!", nil)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/profile", headers: bearer(reg.AccessToken), rawBody: rawBody("null"),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] != "Request body is required." {
		t.Errorf("error = %q, want Request body is required.", body["error"])
	}
}

func TestUpdateProfile_ErrorCase_TrailingJSONReturnsBadRequest(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	reg := registerUser(t, srv, "profiletrail@example.com", "profiletrail", "Password123!", nil)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/auth/profile", headers: bearer(reg.AccessToken), rawBody: rawBody(`{} {}`),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
