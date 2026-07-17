//go:build integration

// Package habits_test's public-surface suite covers GET
// /habits/public/{username} and GET /habits/public/{username}/flame.svg:
// username resolution via a real auth.Service (registered in-process, not
// over HTTP — see newTestServerWithAuth), PrivateNote's absence from every
// public projection, IsPublicOnFlame gating, and the UTC-not-viewer-timezone
// share-surface contract (proven here by showing an X-Timezone header has no
// effect on either endpoint's output, since neither reads it).
package habits_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

func TestPublicFlameProfile_HappyPath_IncludesPromiseWhenPublic(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, _ := newTestServerWithAuth(t)
	username := "pubpromisepublic1"
	reg := registerUserViaService(t, authService, "pubpromisepublic1@example.com", username)
	a := bearerFor(t, tokens, reg.User.ID)
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	createResp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), IsPublicOnFlame: boolPtr(true), PrivateNote: strPtr("secret diary entry")},
	})
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("creating promise: status = %d, want 201", createResp.StatusCode)
	}

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.PublicFlameProfileResponse](t, resp)
	if body.AvatarURL != nil {
		t.Fatalf("AvatarURL = %v, want nil (no avatar)", body.AvatarURL)
	}
	if len(body.Habits) != 1 {
		t.Fatalf("Habits = %+v, want exactly 1", body.Habits)
	}
	if body.Habits[0].Promise == nil {
		t.Fatal("Promise = nil, want the public promise")
	}
	if !strings.Contains(body.Habits[0].Promise.Statement, "70%") {
		t.Errorf("Promise.Statement = %q, want it to contain 70%%", body.Habits[0].Promise.Statement)
	}
}

func TestPublicFlameProfile_HappyPath_CarriesAvatarURL(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, _ := newTestServerWithAuth(t)
	username := "pubavatar1"
	reg := registerUserViaService(t, authService, "pubavatar1@example.com", username)
	avatar := "https://cdn.example.com/flame.png"
	if _, err := authService.UpdateProfile(context.Background(), reg.User.ID, auth.UpdateProfileRequest{
		AvatarURL: &avatar,
	}); err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	a := bearerFor(t, tokens, reg.User.ID)
	createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Run"})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.PublicFlameProfileResponse](t, resp)
	if body.AvatarURL == nil || *body.AvatarURL != avatar {
		t.Fatalf("AvatarURL = %v, want %s", body.AvatarURL, avatar)
	}
}

func TestPublicFlameProfile_HappyPath_ExcludesPromiseWhenNotPublic(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, _ := newTestServerWithAuth(t)
	username := "pubpromiseprivate1"
	reg := registerUserViaService(t, authService, "pubpromiseprivate1@example.com", username)
	a := bearerFor(t, tokens, reg.User.ID)
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)}, // IsPublicOnFlame defaults false
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.PublicFlameProfileResponse](t, resp)
	if len(body.Habits) != 1 {
		t.Fatalf("Habits = %+v, want exactly 1", body.Habits)
	}
	if body.Habits[0].Promise != nil {
		t.Errorf("Promise = %+v, want nil (IsPublicOnFlame defaults false)", body.Habits[0].Promise)
	}
}

// TestPublicFlameProfile_HappyPath_PrivateNoteNeverInRawJSON asserts
// PrivateNote's absence at the raw-JSON level (not just via a Go struct that
// happens to lack the field) — a stronger check than decoding into
// PublicPromiseResponse, which would silently succeed even if the server
// leaked an extra "privateNote" key some client code never reads.
func TestPublicFlameProfile_HappyPath_PrivateNoteNeverInRawJSON(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, _ := newTestServerWithAuth(t)
	username := "pubpromisenonote1"
	reg := registerUserViaService(t, authService, "pubpromisenonote1@example.com", username)
	a := bearerFor(t, tokens, reg.User.ID)
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), IsPublicOnFlame: boolPtr(true), PrivateNote: strPtr("top secret")},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatalf("decoding raw JSON: %v", err)
	}
	habitsRaw, ok := raw["habits"].([]any)
	if !ok || len(habitsRaw) != 1 {
		t.Fatalf("habits = %+v, want exactly one entry", raw["habits"])
	}
	promiseRaw, ok := habitsRaw[0].(map[string]any)["promise"].(map[string]any)
	if !ok {
		t.Fatal("promise field missing or not an object")
	}
	if _, present := promiseRaw["privateNote"]; present {
		t.Error(`raw JSON contains a "privateNote" key on the public promise projection`)
	}
}

func TestPublicFlameProfile_ErrorCase_UnknownUsernameReturns404(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/no-such-user-ever-registered"})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// TestPublicFlameProfile_HappyPath_IgnoresXTimezoneHeader proves the
// share-surface UTC contract from the outside: an X-Timezone header (which
// only owner surfaces like GET /habits/{id}/stats read) has no effect on
// this endpoint's output, since GetPublicFlameProfile never reads it —
// consistency is always computed with time.UTC as "today".
func TestPublicFlameProfile_HappyPath_IgnoresXTimezoneHeader(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, _ := newTestServerWithAuth(t)
	username := "pubpromisetzignore1"
	reg := registerUserViaService(t, authService, "pubpromisetzignore1@example.com", username)
	a := bearerFor(t, tokens, reg.User.ID)
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC"},
	})

	withoutHeader := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	withHeader := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/public/" + username,
		headers: map[string]string{"X-Timezone": "Pacific/Kiritimati"},
	})

	without := decodeBody[habits.PublicFlameProfileResponse](t, withoutHeader)
	with := decodeBody[habits.PublicFlameProfileResponse](t, withHeader)
	if len(without.Habits) != 1 || len(with.Habits) != 1 {
		t.Fatalf("Habits = %+v / %+v, want exactly 1 each", without.Habits, with.Habits)
	}
	if without.Habits[0].Consistency != with.Habits[0].Consistency {
		t.Errorf("consistency differed with an X-Timezone header: %v vs %v, want identical (the endpoint must ignore it)",
			without.Habits[0].Consistency, with.Habits[0].Consistency)
	}
}

// --- flame.svg ---

func TestFlameBadge_HappyPath_ReturnsSVGWithCacheAndContentTypeHeaders(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, _ := newTestServerWithAuth(t)
	username := "flamebadgehappy1"
	reg := registerUserViaService(t, authService, "flamebadgehappy1@example.com", username)
	a := bearerFor(t, tokens, reg.User.ID)
	createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username + "/flame.svg"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "image/svg+xml" {
		t.Errorf("Content-Type = %q, want image/svg+xml", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "public, max-age=300, s-maxage=300" {
		t.Errorf("Cache-Control = %q, want public, max-age=300, s-maxage=300", cc)
	}
	body := make([]byte, 4096)
	n, _ := resp.Body.Read(body)
	svg := string(body[:n])
	if !strings.HasPrefix(svg, "<svg ") || !strings.Contains(svg, username) {
		t.Errorf("body = %q, want an <svg> containing the username", svg)
	}
}

func TestFlameBadge_HappyPath_NoHabitsReturnsNoneLevelBadge(t *testing.T) {
	t.Parallel()
	srv, _, _, authService, _ := newTestServerWithAuth(t)
	username := "flamebadgenohabits1"
	registerUserViaService(t, authService, "flamebadgenohabits1@example.com", username)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username + "/flame.svg"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := make([]byte, 4096)
	n, _ := resp.Body.Read(body)
	if !strings.Contains(string(body[:n]), "0%") {
		t.Errorf("body = %q, want it to show 0%% consistency with no habits", string(body[:n]))
	}
}

func TestFlameBadge_ErrorCase_UnknownUsernameReturns404(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/no-such-user-ever-registered/flame.svg"})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}
