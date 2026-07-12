//go:build integration

// cascade_integration_test.go covers social's three event hook handlers
// (service.go: handleHabitCreated, handleHabitArchived, handleUserDeleted)
// — the in-process replacement for HabitCreatedSubscriber.cs/
// HabitArchivedSubscriber.cs/UserDeletedSubscriber.cs — plus extends the
// winzy.ai-rdc7.13 transactional-cascade guarantee (already proven for
// auth+habits in internal/auth/cascade_integration_test.go) to also cover
// social's own UserDeleted handler joining the same account-delete
// transaction.
package social_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

// --- HabitCreated hook ---

func TestHabitCreatedHook_HappyPath_InsertsDefaultVisibility(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	settings := body["habits"].([]any)
	if len(settings) != 1 {
		t.Fatalf("visibility settings = %+v, want exactly 1 (auto-created at habit creation)", settings)
	}
	entry := settings[0].(map[string]any)
	if entry["habitId"] != habit.ID || entry["visibility"] != "private" {
		t.Errorf("entry = %+v, want habitId=%s visibility=private", entry, habit.ID)
	}
}

func TestHabitCreatedHook_HappyPath_UsesOwnerDefaultPreference(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "public"}})

	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	entry := body["habits"].([]any)[0].(map[string]any)
	if entry["habitId"] != habit.ID || entry["visibility"] != "public" {
		t.Errorf("entry = %+v, want visibility=public (matching the preference set before creation)", entry)
	}
}

func TestHabitCreatedHook_EdgeCase_DoubleFireIsIdempotent(t *testing.T) {
	stack := newTestStack(t)
	userID, habitID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"

	// Emitting the same event twice must not error (ON CONFLICT DO NOTHING)
	// and must not leave more than one row — matching
	// HabitCreatedSubscriber.cs's existence check under redelivery.
	if err := events.Emit(context.Background(), stack.registry, events.HabitCreated{UserID: userID, HabitID: habitID, Name: "Workout"}); err != nil {
		t.Fatalf("first Emit(HabitCreated) error = %v", err)
	}
	if err := events.Emit(context.Background(), stack.registry, events.HabitCreated{UserID: userID, HabitID: habitID, Name: "Workout"}); err != nil {
		t.Fatalf("second Emit(HabitCreated) error = %v", err)
	}

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 1 {
		t.Errorf("visibility settings = %+v, want exactly 1 despite double-fire", body["habits"])
	}
}

// --- HabitArchived hook ---

func TestHabitArchivedHook_HappyPath_DeletesVisibilitySetting(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "friends"}})

	archiveResp := doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID, headers: a})
	if archiveResp.StatusCode != http.StatusNoContent {
		t.Fatalf("archiving habit: status = %d, want 204", archiveResp.StatusCode)
	}

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 0 {
		t.Errorf("visibility settings = %+v, want empty after archiving", body["habits"])
	}
}

func TestHabitArchivedHook_EdgeCase_NoSettingDoesNotFail(t *testing.T) {
	stack := newTestStack(t)
	// Redelivery / a habit that never had a visibility row for some reason —
	// deleting a non-existent row is a no-op, not an error.
	err := events.Emit(context.Background(), stack.registry,
		events.HabitArchived{UserID: "11111111-1111-1111-1111-111111111111", HabitID: "22222222-2222-2222-2222-222222222222"})
	if err != nil {
		t.Errorf("Emit(HabitArchived) for a habit with no visibility row returned an error: %v", err)
	}
}

// --- UserDeleted hook (full cascade) ---

func TestUserDeletedHook_HappyPath_RemovesEverySocialRow(t *testing.T) {
	stack := newTestStack(t)
	owner := registerUserViaService(t, stack.authService, "cascadeowner@example.com", "cascadeowner")
	friend := registerUserViaService(t, stack.authService, "cascadefriend@example.com", "cascadefriend")
	createFriendship(t, stack, owner.User.ID, friend.User.ID)

	a := bearerFor(t, stack.tokens, owner.User.ID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "friends"}})
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "public"}})
	created := createWitnessLink(t, stack, a, "Coach", []string{habit.ID})
	linkID := created["id"].(string)

	if err := stack.authService.DeleteAccount(context.Background(), owner.User.ID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	// Friendships (both directions) gone.
	friendStillExists, err := stack.socialService.AreFriends(t.Context(), friend.User.ID, owner.User.ID)
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	if friendStillExists {
		t.Error("friendship survived UserDeleted cascade")
	}

	// Witness link and its habit allowlist gone: the public viewer must
	// 404 the same as an unknown token (constant-time-404 contract).
	viewResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + created["token"].(string)})
	if viewResp.StatusCode != http.StatusNotFound {
		t.Errorf("witness link view after UserDeleted: status = %d, want 404", viewResp.StatusCode)
	}
	_ = linkID
}

// --- Extending the winzy.ai-rdc7.13 transactional cascade to auth+habits+social ---

func TestDeleteAccount_ErrorCase_FailingHandlerRollsBackSocialToo(t *testing.T) {
	stack := newTestStack(t)
	reg := registerUserViaService(t, stack.authService, "socialrollback@example.com", "socialrollback")

	a := bearerFor(t, stack.tokens, reg.User.ID)
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "public"}})

	// social.NewService already registered its own UserDeleted handler
	// (before this test-added one); registering a failing handler AFTER it
	// proves social's writes joined the same transaction and roll back too
	// when a later handler fails — the same shape as
	// internal/auth/cascade_integration_test.go's habits-focused version,
	// extended to social.
	wantErr := errors.New("simulated downstream cascade failure")
	events.Register(stack.registry, events.Handler[events.UserDeleted](func(_ context.Context, _ events.UserDeleted) error {
		return wantErr
	}))

	err := stack.authService.DeleteAccount(context.Background(), reg.User.ID)
	if !errors.Is(err, wantErr) {
		t.Fatalf("DeleteAccount() error = %v, want it to wrap %v", err, wantErr)
	}

	// The visibility setting created above must still exist — social's
	// delete should have rolled back along with the (also rolled back)
	// account delete.
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 1 {
		t.Errorf("visibility settings after rolled-back DeleteAccount = %+v, want the row to still exist", body["habits"])
	}
}

func TestDeleteAccount_HappyPath_CommitRemovesSocialDataToo(t *testing.T) {
	stack := newTestStack(t)
	reg := registerUserViaService(t, stack.authService, "socialcommit@example.com", "socialcommit")

	a := bearerFor(t, stack.tokens, reg.User.ID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "friends"}})

	if err := stack.authService.DeleteAccount(context.Background(), reg.User.ID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}

	prefResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/preferences", headers: a})
	prefBody := decodeBody[map[string]any](t, prefResp)
	if prefBody["defaultHabitVisibility"] != "private" {
		t.Errorf("preference after deletion+re-read = %v, want private (the deleted row is gone, so this is a fresh default)", prefBody["defaultHabitVisibility"])
	}
}
