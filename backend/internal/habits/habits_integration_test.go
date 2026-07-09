//go:build integration

package habits_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

func newUserID(t *testing.T, suffix string) string {
	t.Helper()
	// A fixed-prefix, varying-suffix UUID keeps test users readable in
	// failures while staying a valid uuid (canonical hex, no real
	// collision risk across the handful of users any one test creates).
	return "00000000-0000-4000-8000-" + suffix
}

// --- POST /habits ---

func TestCreateHabit_HappyPath_ReturnsCreatedWithFields(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000001"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits", headers: a,
		body: habits.CreateHabitRequest{Name: "Exercise", Icon: strPtr("dumbbell"), Color: strPtr("#FF5733")},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	if resp.Header.Get("Location") == "" {
		t.Error("response should set a Location header")
	}

	body := decodeBody[habits.HabitResponse](t, resp)
	if body.Name != "Exercise" || *body.Icon != "dumbbell" || *body.Color != "#FF5733" {
		t.Errorf("body = %+v, want Exercise/dumbbell/#FF5733", body)
	}
	if body.Frequency != "daily" {
		t.Errorf("Frequency = %q, want daily (default)", body.Frequency)
	}
	if body.ArchivedAt != nil {
		t.Error("ArchivedAt should be nil for a freshly created habit")
	}
}

func TestCreateHabit_EdgeCase_WeeklyWithCustomDaysPersists(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000002"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits", headers: a,
		body: habits.CreateHabitRequest{Name: "Yoga", Frequency: freqPtr(habits.FrequencyWeekly), CustomDays: []int{1, 3, 5}},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[habits.HabitResponse](t, resp)
	if body.Frequency != "weekly" {
		t.Errorf("Frequency = %q, want weekly", body.Frequency)
	}
	if len(body.CustomDays) != 3 || body.CustomDays[0] != 1 {
		t.Errorf("CustomDays = %v, want [1 3 5]", body.CustomDays)
	}
}

func TestCreateHabit_EdgeCase_WithoutMinimumDescriptionReturnsNull(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000003"))

	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})
	if habit.MinimumDescription != nil {
		t.Errorf("MinimumDescription = %v, want nil", habit.MinimumDescription)
	}
}

func TestCreateHabit_ErrorCase_MissingNameReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000004"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits", headers: a,
		body: habits.CreateHabitRequest{Name: ""},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
	errBody := decodeBody[map[string]string](t, resp)
	if errBody["error"] == "" {
		t.Error(`400 response body should have a non-empty "error" field`)
	}
}

func TestCreateHabit_ErrorCase_CustomFrequencyWithoutDaysReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000005"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits", headers: a,
		body: habits.CreateHabitRequest{Name: "Gym", Frequency: freqPtr(habits.FrequencyCustom)},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCreateHabit_ErrorCase_MinimumDescriptionTooLongReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000006"))

	long := string(make([]byte, 513))
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits", headers: a,
		body: habits.CreateHabitRequest{Name: "Test", MinimumDescription: &long},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCreateHabit_ErrorCase_MalformedJSONReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000007"))

	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits", headers: a, rawBody: "{invalid json"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] != "Invalid JSON in request body" {
		t.Errorf(`error = %q, want "Invalid JSON in request body"`, body["error"])
	}
}

func TestCreateHabit_ErrorCase_EmptyBodyReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000008"))

	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] != "Invalid JSON in request body" {
		t.Errorf(`error = %q, want "Invalid JSON in request body"`, body["error"])
	}
}

func TestCreateHabit_HappyPath_EmitsHabitCreated(t *testing.T) {
	srv, tokens, registry := newTestServer(t)
	userID := newUserID(t, "000000000009")
	a := bearerFor(t, tokens, userID)

	var captured []events.HabitCreated
	events.Register(registry, func(_ context.Context, e events.HabitCreated) error {
		captured = append(captured, e)
		return nil
	})

	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Event Test"})

	if len(captured) != 1 {
		t.Fatalf("captured %d HabitCreated events, want 1", len(captured))
	}
	if captured[0].UserID != userID || captured[0].HabitID != habit.ID || captured[0].Name != "Event Test" {
		t.Errorf("captured event = %+v, want UserID=%s HabitID=%s Name=Event Test", captured[0], userID, habit.ID)
	}
}

// --- GET /habits ---

func TestListHabits_HappyPath_ReturnsOwnHabitsOnly(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	userA := bearerFor(t, tokens, newUserID(t, "00000000000a"))
	userB := bearerFor(t, tokens, newUserID(t, "00000000000b"))

	createHabit(t, srv, userA, habits.CreateHabitRequest{Name: "My Habit"})
	createHabit(t, srv, userB, habits.CreateHabitRequest{Name: "Other Habit"})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits", headers: userA})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	list := decodeBody[[]habits.HabitResponse](t, resp)
	if len(list) != 1 || list[0].Name != "My Habit" {
		t.Errorf("list = %+v, want exactly [My Habit]", list)
	}
}

func TestListHabits_EdgeCase_ExcludesArchivedHabits(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000c"))

	archived := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Archived"})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + archived.ID, headers: a})
	createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Active"})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits", headers: a})
	list := decodeBody[[]habits.HabitResponse](t, resp)
	if len(list) != 1 || list[0].Name != "Active" {
		t.Errorf("list = %+v, want exactly [Active]", list)
	}
}

// --- GET /habits/{id} ---

func TestGetHabit_HappyPath_ReturnsHabit(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000d"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + created.ID, headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.HabitResponse](t, resp)
	if body.Name != "Read" {
		t.Errorf("Name = %q, want Read", body.Name)
	}
}

func TestGetHabit_ErrorCase_OtherUsersHabitReturns404(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	owner := bearerFor(t, tokens, newUserID(t, "00000000000e"))
	other := bearerFor(t, tokens, newUserID(t, "00000000000f"))
	created := createHabit(t, srv, owner, habits.CreateHabitRequest{Name: "Secret"})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + created.ID, headers: other})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (never 403) for another user's habit", resp.StatusCode)
	}
}

func TestGetHabit_ErrorCase_NonExistentIDReturns404(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000010"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/123e4567-e89b-12d3-a456-426614174000", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestGetHabit_EdgeCase_MalformedIDReturns404(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000011"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/not-a-uuid", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (a non-uuid segment can never match a row)", resp.StatusCode)
	}
}

// --- PUT /habits/{id} ---

func TestUpdateHabit_HappyPath_UpdatesNameAndColor(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000012"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID, headers: a,
		body: habits.UpdateHabitRequest{Name: strPtr("Read Books"), Color: strPtr("#00FF00")},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.HabitResponse](t, resp)
	if body.Name != "Read Books" || *body.Color != "#00FF00" {
		t.Errorf("body = %+v, want Read Books / #00FF00", body)
	}
}

func TestUpdateHabit_EdgeCase_ChangeToWeeklyWithDaysPersists(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000013"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID, headers: a,
		body: habits.UpdateHabitRequest{Frequency: freqPtr(habits.FrequencyWeekly), CustomDays: []int{0, 6}},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.HabitResponse](t, resp)
	if body.Frequency != "weekly" || len(body.CustomDays) != 2 {
		t.Errorf("body = %+v, want weekly with 2 custom days", body)
	}
}

func TestUpdateHabit_ErrorCase_ChangeToWeeklyWithoutDaysReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000014"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID, headers: a,
		body: habits.UpdateHabitRequest{Frequency: freqPtr(habits.FrequencyWeekly)},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUpdateHabit_ErrorCase_OtherUsersHabitReturns404(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	owner := bearerFor(t, tokens, newUserID(t, "000000000015"))
	attacker := bearerFor(t, tokens, newUserID(t, "000000000016"))
	created := createHabit(t, srv, owner, habits.CreateHabitRequest{Name: "Other"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID, headers: attacker,
		body: habits.UpdateHabitRequest{Name: strPtr("Hacked")},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateHabit_HappyPath_AddMinimumDescription(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000017"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Meditate"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID, headers: a,
		body: habits.UpdateHabitRequest{MinimumDescription: strPtr("2 minutes of breathing")},
	})
	body := decodeBody[habits.HabitResponse](t, resp)
	if body.MinimumDescription == nil || *body.MinimumDescription != "2 minutes of breathing" {
		t.Errorf("MinimumDescription = %v, want '2 minutes of breathing'", body.MinimumDescription)
	}
}

func TestUpdateHabit_EdgeCase_ClearMinimumDescriptionReturnsNull(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000018"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Meditate", MinimumDescription: strPtr("2 minutes")})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID, headers: a,
		body: habits.UpdateHabitRequest{ClearMinimumDescription: boolPtr(true)},
	})
	body := decodeBody[habits.HabitResponse](t, resp)
	if body.MinimumDescription != nil {
		t.Errorf("MinimumDescription = %v, want nil after clearing", body.MinimumDescription)
	}
}

// --- DELETE /habits/{id} ---

func TestArchiveHabit_HappyPath_SoftArchivesAndHidesFromGet(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000019"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Delete Me"})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID, headers: a})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	getResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + created.ID, headers: a})
	if getResp.StatusCode != http.StatusNotFound {
		t.Errorf("GET after archive status = %d, want 404 (soft-archived habits are hidden from active lookups)", getResp.StatusCode)
	}
}

func TestArchiveHabit_EdgeCase_AlreadyArchivedIsIdempotent(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000001a"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Archive Twice"})

	first := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID, headers: a})
	if first.StatusCode != http.StatusNoContent {
		t.Fatalf("first archive status = %d, want 204", first.StatusCode)
	}
	second := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID, headers: a})
	if second.StatusCode != http.StatusNoContent {
		t.Errorf("second archive status = %d, want 204 (idempotent)", second.StatusCode)
	}
}

func TestArchiveHabit_HappyPath_EmitsHabitArchived(t *testing.T) {
	srv, tokens, registry := newTestServer(t)
	userID := newUserID(t, "00000000001b")
	a := bearerFor(t, tokens, userID)
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Event Test"})

	var captured []events.HabitArchived
	events.Register(registry, func(_ context.Context, e events.HabitArchived) error {
		captured = append(captured, e)
		return nil
	})

	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID, headers: a})

	if len(captured) != 1 || captured[0].HabitID != created.ID || captured[0].UserID != userID {
		t.Errorf("captured = %+v, want one HabitArchived for %s/%s", captured, userID, created.ID)
	}
}

func TestArchiveHabit_ErrorCase_NonExistentReturns404(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000001c"))

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/123e4567-e89b-12d3-a456-426614174000", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// --- helpers ---

func strPtr(s string) *string                      { return &s }
func boolPtr(b bool) *bool                         { return &b }
func freqPtr(f habits.Frequency) *habits.Frequency { return &f }
