//go:build integration

package social_test

import (
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

// --- PUT /social/visibility/{habitId} ---

func TestSetHabitVisibility_HappyPath_NewSettingReturns200(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, userID)
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a,
		body: map[string]string{"visibility": "friends"},
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["visibility"] != "friends" || body["habitId"] != habit.ID {
		t.Errorf("body = %+v, want visibility=friends habitId=%s", body, habit.ID)
	}
}

// FIX 12 (winzy.ai-rdc7.4 review): an omitted visibility field ({} body)
// must persist/return "private" — C#'s non-nullable enum defaults an
// omitted property to its zero value (Private), which then passes
// Enum.IsDefined — not the empty string the Go zero value previously
// leaked into storage and into the emitted VisibilityChanged event.
func TestSetHabitVisibility_EdgeCase_OmittedBodyDefaultsToPrivate(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, userID)
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a,
		body: map[string]any{},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["visibility"] != "private" {
		t.Errorf("visibility = %v, want private", body["visibility"])
	}

	// Persisted, not just echoed — a subsequent GET reflects the same value.
	batchResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	batchBody := decodeBody[map[string]any](t, batchResp)
	settings := batchBody["habits"].([]any)[0].(map[string]any)
	if settings["visibility"] != "private" {
		t.Errorf("persisted visibility = %v, want private", settings["visibility"])
	}
}

func TestSetHabitVisibility_HappyPath_UpdateExistingReturns200(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, userID)
	habit := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})

	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "friends"}})
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: a, body: map[string]string{"visibility": "public"}})

	body := decodeBody[map[string]any](t, resp)
	if body["visibility"] != "public" {
		t.Errorf("visibility = %v, want public", body["visibility"])
	}
}

func TestSetHabitVisibility_ErrorCase_MissingAuthReturns401(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPut, path: "/social/visibility/11111111-1111-1111-1111-111111111111",
		body: map[string]string{"visibility": "friends"},
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestSetHabitVisibility_ErrorCase_HabitNotOwnedReturns404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPut, path: "/social/visibility/22222222-2222-2222-2222-222222222222", headers: a,
		body: map[string]string{"visibility": "friends"},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (no habit with this id exists at all)", resp.StatusCode)
	}
}

func TestSetHabitVisibility_ErrorCase_AnotherUsersHabitReturns404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	owner := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	stranger := bearerFor(t, stack.tokens, "22222222-2222-2222-2222-222222222222")
	habit := createHabit(t, stack.srv, owner, habits.CreateHabitRequest{Name: "Workout"})

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: stranger,
		body: map[string]string{"visibility": "friends"},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (habit belongs to someone else)", resp.StatusCode)
	}
}

func TestSetHabitVisibility_ErrorCase_MalformedJSONReturns400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/11111111-1111-1111-1111-111111111111", headers: a, rawBody: "not valid json"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestSetHabitVisibility_ErrorCase_EmptyBodyReturns400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/11111111-1111-1111-1111-111111111111", headers: a, rawBody: ""})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// --- GET /social/visibility (batch) ---

func TestGetBatchVisibility_HappyPath_ReturnsAllSettings(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})

	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h1.ID, headers: a, body: map[string]string{"visibility": "friends"}})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h2.ID, headers: a, body: map[string]string{"visibility": "public"}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if body["defaultVisibility"] != "private" {
		t.Errorf("defaultVisibility = %v, want private", body["defaultVisibility"])
	}
	if len(body["habits"].([]any)) != 2 {
		t.Errorf("habits = %+v, want 2 entries", body["habits"])
	}
}

func TestGetBatchVisibility_EdgeCase_EmptyWhenNoSettings(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 0 {
		t.Errorf("habits = %+v, want empty", body["habits"])
	}
}

func TestGetBatchVisibility_HappyPath_ReflectsDefaultPreference(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "friends"}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/visibility", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if body["defaultVisibility"] != "friends" {
		t.Errorf("defaultVisibility = %v, want friends", body["defaultVisibility"])
	}
}

// --- GET/PUT /social/preferences ---

func TestGetPreferences_EdgeCase_NoPreferencesSetReturnsPrivateDefault(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/preferences", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if body["defaultHabitVisibility"] != "private" {
		t.Errorf("defaultHabitVisibility = %v, want private", body["defaultHabitVisibility"])
	}
}

func TestUpdatePreferences_HappyPath_ValidUpdateReturns200(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "friends"}})
	body := decodeBody[map[string]any](t, resp)
	if body["defaultHabitVisibility"] != "friends" {
		t.Errorf("defaultHabitVisibility = %v, want friends", body["defaultHabitVisibility"])
	}

	getResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/preferences", headers: a})
	getBody := decodeBody[map[string]any](t, getResp)
	if getBody["defaultHabitVisibility"] != "friends" {
		t.Errorf("GET after PUT = %v, want friends", getBody["defaultHabitVisibility"])
	}
}

// FIX 12 (winzy.ai-rdc7.4 review): {} body on PUT /social/preferences must
// persist/return "private" — see the identical case for
// PUT /social/visibility/{id} above.
func TestUpdatePreferences_EdgeCase_OmittedBodyDefaultsToPrivate(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	// Prove the default is actually applied, not just already-Private by
	// coincidence: set it to something else first.
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "public"}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]any{}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["defaultHabitVisibility"] != "private" {
		t.Errorf("defaultHabitVisibility = %v, want private", body["defaultHabitVisibility"])
	}

	getResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/preferences", headers: a})
	getBody := decodeBody[map[string]any](t, getResp)
	if getBody["defaultHabitVisibility"] != "private" {
		t.Errorf("persisted defaultHabitVisibility = %v, want private", getBody["defaultHabitVisibility"])
	}
}

func TestUpdatePreferences_HappyPath_UpdateExistingReturns200(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "friends"}})
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, body: map[string]string{"defaultHabitVisibility": "public"}})

	body := decodeBody[map[string]any](t, resp)
	if body["defaultHabitVisibility"] != "public" {
		t.Errorf("defaultHabitVisibility = %v, want public", body["defaultHabitVisibility"])
	}
}

func TestUpdatePreferences_ErrorCase_MalformedJSONReturns400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, rawBody: "not valid json"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUpdatePreferences_ErrorCase_EmptyBodyReturns400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: a, rawBody: ""})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
