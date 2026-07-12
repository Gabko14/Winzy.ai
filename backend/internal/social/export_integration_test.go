//go:build integration

package social_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

// --- Happy path ---

func TestExport_HappyPath_WithFriendsAndPreferencesReturnsFullData(t *testing.T) {
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "friends"}})
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "public"}})

	services, warnings := exportViaRegistry(t, stack, userID)
	if hasWarningFor(warnings, "social") {
		t.Errorf("warnings = %v, want none for the social section", warnings)
	}
	data := findExportSectionData(t, services, "social")

	friends := data["friends"].([]any)
	if len(friends) != 1 || friends[0].(map[string]any)["friendUserId"] != friendID {
		t.Errorf("friends = %+v, want exactly [%s]", friends, friendID)
	}
	if len(data["pendingRequests"].([]any)) != 0 {
		t.Errorf("pendingRequests = %+v, want none (already accepted)", data["pendingRequests"])
	}
	prefs := data["preferences"].(map[string]any)
	if prefs["defaultHabitVisibility"] != "friends" {
		t.Errorf("defaultHabitVisibility = %v, want friends", prefs["defaultHabitVisibility"])
	}
	visibility := data["visibilitySettings"].([]any)
	if len(visibility) != 1 || visibility[0].(map[string]any)["visibility"] != "public" {
		t.Errorf("visibilitySettings = %+v, want exactly one public entry", visibility)
	}
}

func TestExport_HappyPath_PendingRequestsIncludeDirection(t *testing.T) {
	stack := newTestStack(t)
	userID, otherID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	third := "33333333-3333-3333-3333-333333333333"

	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": otherID}})

	other := bearerFor(t, stack.tokens, third)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: other, body: map[string]string{"friendId": userID}})

	services, _ := exportViaRegistry(t, stack, userID)
	data := findExportSectionData(t, services, "social")
	pending := data["pendingRequests"].([]any)
	if len(pending) != 2 {
		t.Fatalf("pendingRequests = %+v, want 2 (one sent, one received)", pending)
	}
	directions := map[string]bool{}
	for _, p := range pending {
		directions[p.(map[string]any)["direction"].(string)] = true
	}
	if !directions["sent"] || !directions["received"] {
		t.Errorf("directions = %+v, want both sent and received present", directions)
	}
}

// --- Edge cases / error conditions ---

func TestExport_ErrorCase_NoSocialDataOmitsSection(t *testing.T) {
	stack := newTestStack(t)
	unknownUserID := "99999999-9999-9999-9999-999999999999"

	services, warnings := exportViaRegistry(t, stack, unknownUserID)
	if hasWarningFor(warnings, "social") {
		t.Errorf("warnings = %v, want none for social (ErrNoData is silent, not a warning)", warnings)
	}
	for _, s := range services {
		if s.Service == "social" {
			t.Fatalf("social section present = %+v, want omitted for a user with no social data", s)
		}
	}
}

func TestExport_EdgeCase_OnlyPreferencesStillIncluded(t *testing.T) {
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "public"}})

	services, _ := exportViaRegistry(t, stack, userID)
	data := findExportSectionData(t, services, "social")
	if len(data["friends"].([]any)) != 0 {
		t.Errorf("friends = %+v, want empty", data["friends"])
	}
}

func TestExport_EdgeCase_OnlyWitnessLinksStillIncluded(t *testing.T) {
	// witnessLinks is a genuine addition over the C# source (see export.go's
	// witnessLinkExport doc comment) — a user with ONLY a witness link (no
	// friends/preferences/visibility settings) must not be treated as
	// having "no social data".
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, userID)
	createWitnessLink(t, stack, a, "Coach", nil)

	services, _ := exportViaRegistry(t, stack, userID)
	data := findExportSectionData(t, services, "social")
	links := data["witnessLinks"].([]any)
	if len(links) != 1 {
		t.Errorf("witnessLinks = %+v, want exactly 1", links)
	}
}

// exportViaRegistry runs every registered export.Section for userID directly
// against the shared export.Registry the test stack wires, bypassing
// auth.Service.Export's user-existence check and rate limit — this suite is
// exercising social's own export.Section (export.go), not auth's export
// orchestration endpoint, so callers here use arbitrary UUIDs that were
// never registered through auth.Service.Register.
func exportViaRegistry(t *testing.T, stack testStack, userID string) ([]export.ServiceExport, []string) {
	t.Helper()
	services, warnings := stack.exportReg.Export(t.Context(), userID)
	return services, warnings
}

// findExportSectionData locates the named section and round-trips its Data
// through JSON into a generic map — Export's registry call (unlike the real
// GET /auth/export HTTP endpoint) hands back the section's concrete Go type
// (socialExportData, unexported outside the social package), so tests in
// this external social_test package inspect it the same way a real HTTP
// client would: as decoded JSON.
func findExportSectionData(t *testing.T, services []export.ServiceExport, name string) map[string]any {
	t.Helper()
	for _, s := range services {
		if s.Service != name {
			continue
		}
		raw, err := json.Marshal(s.Data)
		if err != nil {
			t.Fatalf("marshaling %q section data: %v", name, err)
		}
		var data map[string]any
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatalf("unmarshaling %q section data: %v", name, err)
		}
		return data
	}
	t.Fatalf("no %q section in export output: %+v", name, services)
	return nil
}

// hasWarningFor reports whether any warning mentions name — export.Registry
// formats each as "Failed to export data from {name}".
func hasWarningFor(warnings []string, name string) bool {
	for _, w := range warnings {
		if strings.Contains(w, name) {
			return true
		}
	}
	return false
}
