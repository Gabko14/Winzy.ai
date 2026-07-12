//go:build integration

// cross_integration_test.go covers social's exported cross-module API
// (crossmodule.go: FriendIDs, AreFriends, VisibleHabitIDsForViewer/
// VisibleHabitIDs) via direct method calls — matching how the old C# system
// tested these as HTTP endpoints (InternalFriendsCheck_*,
// InternalVisibleHabits_* in FriendshipEndpointTests.cs/
// VisibilityEndpointTests.cs), except none of the three are HTTP routes
// here (see crossmodule.go's doc comment for why). It also covers the
// winzy.ai-rdc7.4 integration point end to end: GET /habits/public/{username}
// actually filtering by social's visibility settings once
// habits.Service.SetVisibilityFilter is wired (newTestStack always wires
// it, matching cmd/api/main.go).
package social_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

// --- FriendIDs (replaces InternalFriendsCheck_*'s GetFriendIds coverage) ---

func TestFriendIDs_HappyPath_ReturnsAcceptedFriends(t *testing.T) {
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	ids, err := stack.socialService.FriendIDs(t.Context(), userID)
	if err != nil {
		t.Fatalf("FriendIDs() error = %v", err)
	}
	if len(ids) != 1 || ids[0] != friendID {
		t.Errorf("FriendIDs() = %v, want [%s]", ids, friendID)
	}
}

func TestFriendIDs_EdgeCase_EmptyWhenNoFriends(t *testing.T) {
	stack := newTestStack(t)
	ids, err := stack.socialService.FriendIDs(t.Context(), "11111111-1111-1111-1111-111111111111")
	if err != nil {
		t.Fatalf("FriendIDs() error = %v", err)
	}
	if len(ids) != 0 {
		t.Errorf("FriendIDs() = %v, want empty", ids)
	}
}

// --- AreFriends (replaces InternalFriendsCheck_*) ---

func TestAreFriends_HappyPath_AcceptedReturnsTrue(t *testing.T) {
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	areFriends, err := stack.socialService.AreFriends(t.Context(), userID, friendID)
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	if !areFriends {
		t.Error("AreFriends() = false, want true for an accepted friendship")
	}
}

func TestAreFriends_ErrorCase_NoRelationshipReturnsFalse(t *testing.T) {
	stack := newTestStack(t)
	areFriends, err := stack.socialService.AreFriends(t.Context(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	if areFriends {
		t.Error("AreFriends() = true, want false with no relationship at all")
	}
}

func TestAreFriends_ErrorCase_PendingRequestReturnsFalse(t *testing.T) {
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})

	areFriends, err := stack.socialService.AreFriends(t.Context(), userID, friendID)
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	if areFriends {
		t.Error("AreFriends() = true, want false for a merely-pending request")
	}
}

// --- VisibleHabitIDsForViewer (replaces InternalVisibleHabits_*) ---

func TestVisibleHabitIDsForViewer_HappyPath_PublicViewerReturnsPublicOnly(t *testing.T) {
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, userID)
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h1.ID, headers: a, body: map[string]string{"visibility": "public"}})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h2.ID, headers: a, body: map[string]string{"visibility": "friends"}})

	visible, err := stack.socialService.VisibleHabitIDsForViewer(t.Context(), userID, []string{h1.ID, h2.ID}, "")
	if err != nil {
		t.Fatalf("VisibleHabitIDsForViewer() error = %v", err)
	}
	if !visible[h1.ID] || visible[h2.ID] {
		t.Errorf("visible = %+v, want only h1 (public) visible to the anonymous viewer", visible)
	}
}

func TestVisibleHabitIDsForViewer_HappyPath_FriendViewerSeesFriendsAndPublic(t *testing.T) {
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)
	a := bearerFor(t, stack.tokens, userID)
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h1.ID, headers: a, body: map[string]string{"visibility": "public"}})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h2.ID, headers: a, body: map[string]string{"visibility": "friends"}})

	visible, err := stack.socialService.VisibleHabitIDsForViewer(t.Context(), userID, []string{h1.ID, h2.ID}, friendID)
	if err != nil {
		t.Fatalf("VisibleHabitIDsForViewer() error = %v", err)
	}
	if !visible[h1.ID] || !visible[h2.ID] {
		t.Errorf("visible = %+v, want both visible to a friend", visible)
	}
}

func TestVisibleHabitIDsForViewer_ErrorCase_NonFriendViewerSeesPublicOnly(t *testing.T) {
	stack := newTestStack(t)
	userID, strangerID := "11111111-1111-1111-1111-111111111111", "33333333-3333-3333-3333-333333333333"
	a := bearerFor(t, stack.tokens, userID)
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h1.ID, headers: a, body: map[string]string{"visibility": "public"}})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h2.ID, headers: a, body: map[string]string{"visibility": "friends"}})

	visible, err := stack.socialService.VisibleHabitIDsForViewer(t.Context(), userID, []string{h1.ID, h2.ID}, strangerID)
	if err != nil {
		t.Fatalf("VisibleHabitIDsForViewer() error = %v", err)
	}
	if !visible[h1.ID] || visible[h2.ID] {
		t.Errorf("visible = %+v, want only the public habit visible to a non-friend", visible)
	}
}

func TestVisibleHabitIDsForViewer_EdgeCase_DefaultPublicExcludesExplicitNonPublic(t *testing.T) {
	// The HabitCreated hook eagerly materializes a visibility_settings row
	// at whatever the owner's default is AT CREATION TIME (see
	// service.go's handleHabitCreated) — so once a real habit exists, it
	// always has an "explicit" row, even if that row's value happens to
	// equal the default. To genuinely exercise effectiveVisibility's
	// no-row-at-all fallback branch (as opposed to "a row that happens to
	// equal the default"), noHookHabitID below is a synthetic id that was
	// never created through the habits module at all, so no hook ever ran
	// for it.
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	noHookHabitID := "99999999-9999-9999-9999-999999999999"
	a := bearerFor(t, stack.tokens, userID)

	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "public"}})
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h1.ID, headers: a, body: map[string]string{"visibility": "friends"}})

	visible, err := stack.socialService.VisibleHabitIDsForViewer(t.Context(), userID, []string{h1.ID, noHookHabitID}, "")
	if err != nil {
		t.Fatalf("VisibleHabitIDsForViewer() error = %v", err)
	}
	if visible[h1.ID] {
		t.Errorf("visible = %+v, want h1 (explicitly friends) excluded from the public view even though default=public", visible)
	}
	if !visible[noHookHabitID] {
		t.Errorf("visible = %+v, want the no-row habit visible via the public default", visible)
	}
}

func TestVisibleHabitIDsForViewer_HappyPath_FriendSeesAtLeastAsMuchAsPublic(t *testing.T) {
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)
	a := bearerFor(t, stack.tokens, userID)
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h1.ID, headers: a, body: map[string]string{"visibility": "friends"}})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h2.ID, headers: a, body: map[string]string{"visibility": "public"}})

	public, err := stack.socialService.VisibleHabitIDsForViewer(t.Context(), userID, []string{h1.ID, h2.ID}, "")
	if err != nil {
		t.Fatalf("VisibleHabitIDsForViewer(public) error = %v", err)
	}
	friend, err := stack.socialService.VisibleHabitIDsForViewer(t.Context(), userID, []string{h1.ID, h2.ID}, friendID)
	if err != nil {
		t.Fatalf("VisibleHabitIDsForViewer(friend) error = %v", err)
	}
	if len(friend) < len(public) {
		t.Errorf("friend visible count %d < public visible count %d, want friend >= public", len(friend), len(public))
	}
	if len(public) != 1 || len(friend) != 2 {
		t.Errorf("public=%v friend=%v, want public={h2} friend={h1,h2}", public, friend)
	}
}

// --- End-to-end: habits.Service.SetVisibilityFilter wiring
// (winzy.ai-rdc7.4's INTEGRATION POINT, now closed) ---

func TestPublicFlameProfile_HappyPath_PublicHabitVisible(t *testing.T) {
	stack := newTestStack(t)
	username := "pubvisiblehappy"
	reg := registerUserViaService(t, stack.authService, "pubvisiblehappy@example.com", username)
	a := bearerFor(t, stack.tokens, reg.User.ID)
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "public"}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 1 {
		t.Fatalf("habits = %+v, want the public habit visible", body["habits"])
	}
}

func TestPublicFlameProfile_ErrorCase_PrivateHabitExcludedAfterVisibilityChange(t *testing.T) {
	// The core winzy.ai-rdc7.4 regression test: before this bead, habits'
	// public flame page showed every non-archived habit regardless of
	// visibility (see promise_public.go's former INTEGRATION POINT comment).
	// With social wired via SetVisibilityFilter, a habit stays at its
	// default (Private) and must NOT appear.
	stack := newTestStack(t)
	username := "pubexcludedhappy"
	reg := registerUserViaService(t, stack.authService, "pubexcludedhappy@example.com", username)
	a := bearerFor(t, stack.tokens, reg.User.ID)
	createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Secret Journal"})
	// No visibility change — stays at the default (Private).

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 0 {
		t.Errorf("habits = %+v, want empty (habit is private, no longer shown now that social is wired)", body["habits"])
	}
}

func TestPublicFlameProfile_HappyPath_BeforeAndAfterVisibilityChange(t *testing.T) {
	stack := newTestStack(t)
	username := "pubbeforeafter"
	reg := registerUserViaService(t, stack.authService, "pubbeforeafter@example.com", username)
	a := bearerFor(t, stack.tokens, reg.User.ID)
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Journaling"})

	before := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	beforeBody := decodeBody[map[string]any](t, before)
	if len(beforeBody["habits"].([]any)) != 0 {
		t.Fatalf("before visibility change: habits = %+v, want empty (default Private)", beforeBody["habits"])
	}

	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "public"}})

	after := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	afterBody := decodeBody[map[string]any](t, after)
	if len(afterBody["habits"].([]any)) != 1 {
		t.Errorf("after visibility change: habits = %+v, want exactly 1 (now Public)", afterBody["habits"])
	}
}
