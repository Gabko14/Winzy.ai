//go:build integration

package habits_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

// --- POST /habits/{id}/complete ---

func TestCompleteHabit_HappyPath_ReturnsCreatedWithConsistencyAndLocalDate(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000001"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "America/New_York"},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	if resp.Header.Get("Location") == "" {
		t.Error("response should set a Location header")
	}
	body := decodeBody[map[string]any](t, resp)
	if _, ok := body["consistency"]; !ok {
		t.Error("response should include a consistency field")
	}
	if _, ok := body["localDate"]; !ok {
		t.Error("response should include a localDate field")
	}
	if body["completionKind"] != "full" {
		t.Errorf("completionKind = %v, want full (default)", body["completionKind"])
	}
}

func TestCompleteHabit_HappyPath_SpecificDateIsHonored(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000002"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	today := time.Now().UTC().Format("2006-01-02")
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "America/New_York"},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["localDate"] != today {
		t.Errorf("localDate = %v, want %s", body["localDate"], today)
	}
}

func TestCompleteHabit_ErrorCase_DuplicateDateReturns409(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000003"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	today := time.Now().UTC().Format("2006-01-02")
	req := testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC"},
	}
	doRequest(t, srv, req)
	resp := doRequest(t, srv, req)

	if resp.StatusCode != http.StatusConflict {
		t.Errorf("status = %d, want 409", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] == "" {
		t.Error(`409 response should have a non-empty "error" field`)
	}
}

func TestCompleteHabit_ErrorCase_MissingTimezoneReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000004"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCompleteHabit_ErrorCase_InvalidTimezoneReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000005"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "Not/A/Timezone"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCompleteHabit_ErrorCase_NonExistentHabitReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000006"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/123e4567-e89b-12d3-a456-426614174000/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC"},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestCompleteHabit_ErrorCase_FutureDateReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000007"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	tomorrow := time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &tomorrow, Timezone: "UTC"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] == "" || !strings.Contains(body["error"], "future") {
		t.Errorf(`error = %q, want it to mention "future"`, body["error"])
	}
}

func TestCompleteHabit_EdgeCase_ExactWindowBoundaryAccepted(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000008"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	windowStart := time.Now().UTC().AddDate(0, 0, -59).Format("2006-01-02")
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &windowStart, Timezone: "UTC"},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, want 201 (exactly 59 days ago is inside the 60-day window)", resp.StatusCode)
	}
}

func TestCompleteHabit_EdgeCase_OneDayBeforeWindowRejected(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000009"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	beforeWindow := time.Now().UTC().AddDate(0, 0, -60).Format("2006-01-02")
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &beforeWindow, Timezone: "UTC"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (60 days ago is outside the window)", resp.StatusCode)
	}
}

// --- Honest Minimums ---

func TestCompleteHabit_HappyPath_FullAndMinimumKindsRoundTrip(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000000a"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Workout", MinimumDescription: strPtr("10-minute walk")})

	full := habits.CompletionFull
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC", CompletionKind: &full},
	})
	body := decodeBody[map[string]any](t, resp)
	if body["completionKind"] != "full" {
		t.Errorf("completionKind = %v, want full", body["completionKind"])
	}

	created2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Workout 2", MinimumDescription: strPtr("10-minute walk")})
	minimum := habits.CompletionMinimum
	resp2 := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created2.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC", CompletionKind: &minimum},
	})
	body2 := decodeBody[map[string]any](t, resp2)
	if body2["completionKind"] != "minimum" {
		t.Errorf("completionKind = %v, want minimum", body2["completionKind"])
	}
}

func TestCompleteHabit_ErrorCase_MinimumWithoutConfigReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000000b"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})

	minimum := habits.CompletionMinimum
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC", CompletionKind: &minimum},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if !strings.Contains(body["error"], "minimum description") {
		t.Errorf(`error = %q, want it to mention "minimum description"`, body["error"])
	}
}

func TestCompleteHabit_ErrorCase_InvalidCompletionKindReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000000c"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Test"})

	none := habits.CompletionNone
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC", CompletionKind: &none},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (None is not a loggable kind)", resp.StatusCode)
	}
}

// --- DELETE /habits/{id}/completions/{date} ---

func TestDeleteCompletion_HappyPath_RemovesCompletion(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000000d"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})
	today := time.Now().UTC().Format("2006-01-02")
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC"},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID + "/completions/" + today, headers: a})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	// Deleting again finds nothing.
	resp2 := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID + "/completions/" + today, headers: a})
	if resp2.StatusCode != http.StatusNotFound {
		t.Errorf("second delete status = %d, want 404", resp2.StatusCode)
	}
}

func TestDeleteCompletion_ErrorCase_NonExistentReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000000e"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID + "/completions/2025-02-15", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestDeleteCompletion_ErrorCase_InvalidDateFormatReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000000f"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + created.ID + "/completions/not-a-date", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestDeleteCompletion_ErrorCase_MalformedHabitIDReturns404(t *testing.T) {
	t.Parallel()
	// CompletionEndpoints.cs maps this route with a `{id:guid}` constraint —
	// a segment that doesn't parse as a Guid never reaches the handler, so
	// ASP.NET falls through to 404. A malformed id must not reach the
	// `::uuid` cast in the store query (which would 500 instead).
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000020"))

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/not-a-uuid/completions/2025-02-15", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (a non-uuid segment can never match a row)", resp.StatusCode)
	}
}

// --- PUT /habits/{id}/completions/{date} ---

func TestUpdateCompletion_HappyPath_MinimumToFullAndBack(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000010"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Workout", MinimumDescription: strPtr("10-minute walk")})
	today := time.Now().UTC().Format("2006-01-02")
	minimum := habits.CompletionMinimum
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC", CompletionKind: &minimum},
	})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID + "/completions/" + today, headers: a,
		body: habits.UpdateCompletionRequest{CompletionKind: habits.CompletionFull},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["completionKind"] != "full" {
		t.Errorf("completionKind = %v, want full", body["completionKind"])
	}
	if _, hasConsistency := body["consistency"]; hasConsistency {
		t.Error("PUT completions response should NOT include a consistency field (matches CompletionEndpoints.cs's UpdateCompletion exactly)")
	}
}

func TestUpdateCompletion_ErrorCase_ToMinimumWithoutConfigReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000011"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})
	today := time.Now().UTC().Format("2006-01-02")
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC"},
	})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID + "/completions/" + today, headers: a,
		body: habits.UpdateCompletionRequest{CompletionKind: habits.CompletionMinimum},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUpdateCompletion_ErrorCase_NonExistentReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000012"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Test"})
	today := time.Now().UTC().Format("2006-01-02")

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID + "/completions/" + today, headers: a,
		body: habits.UpdateCompletionRequest{CompletionKind: habits.CompletionFull},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateCompletion_ErrorCase_MalformedHabitIDReturns404(t *testing.T) {
	t.Parallel()
	// Same `{id:guid}` route-constraint semantics as
	// TestDeleteCompletion_ErrorCase_MalformedHabitIDReturns404 — see that
	// test's comment.
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000014"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/not-a-uuid/completions/2025-02-15", headers: a,
		body: habits.UpdateCompletionRequest{CompletionKind: habits.CompletionFull},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (a non-uuid segment can never match a row)", resp.StatusCode)
	}
}

func TestUpdateCompletion_ErrorCase_InvalidKindReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000013"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Test"})
	today := time.Now().UTC().Format("2006-01-02")
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC"},
	})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/" + created.ID + "/completions/" + today, headers: a,
		body: habits.UpdateCompletionRequest{CompletionKind: habits.CompletionNone},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// --- GET /habits/completions?from=&to= ---

func TestCompletionsInRange_HappyPath_MultiHabitMultiDayMatrix(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000014"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise", MinimumDescription: strPtr("10-min walk")})
	h2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})

	d0 := time.Now().UTC().AddDate(0, 0, -2).Format("2006-01-02")
	d1 := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	d2 := time.Now().UTC().Format("2006-01-02")
	minimum := habits.CompletionMinimum
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + h1.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &d0, Timezone: "UTC", CompletionKind: &minimum},
	})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + h1.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &d2, Timezone: "UTC"},
	})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + h2.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &d1, Timezone: "UTC"},
	})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/completions?from=" + d0 + "&to=" + d2, headers: a,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.CompletionsRangeResponse](t, resp)
	if body.From != d0 || body.To != d2 || len(body.Habits) != 2 {
		t.Fatalf("body = %+v, want from=%s to=%s with 2 habits", body, d0, d2)
	}
	byID := map[string]habits.HabitCompletionsInRange{}
	for _, h := range body.Habits {
		byID[h.ID] = h
		if len(h.Days) != 3 {
			t.Fatalf("habit %s Days = %d, want 3 covering every date", h.ID, len(h.Days))
		}
		if h.Days[0].Date != d0 || h.Days[1].Date != d1 || h.Days[2].Date != d2 {
			t.Errorf("habit %s day dates = %v,%v,%v want %s,%s,%s", h.ID, h.Days[0].Date, h.Days[1].Date, h.Days[2].Date, d0, d1, d2)
		}
	}
	e1 := byID[h1.ID]
	if e1.Frequency != "daily" {
		t.Errorf("h1 Frequency = %q, want daily", e1.Frequency)
	}
	if e1.MinimumDescription == nil || *e1.MinimumDescription != "10-min walk" {
		t.Errorf("h1 MinimumDescription = %v, want 10-min walk", e1.MinimumDescription)
	}
	if !e1.Days[0].Completed || e1.Days[0].CompletionKind == nil || *e1.Days[0].CompletionKind != "minimum" {
		t.Errorf("h1 day0 = %+v, want completed minimum", e1.Days[0])
	}
	if e1.Days[1].Completed {
		t.Errorf("h1 day1 should be incomplete, got %+v", e1.Days[1])
	}
	if !e1.Days[2].Completed || e1.Days[2].CompletionKind == nil || *e1.Days[2].CompletionKind != "full" {
		t.Errorf("h1 day2 = %+v, want completed full", e1.Days[2])
	}
	e2 := byID[h2.ID]
	if e2.Days[0].Completed || !e2.Days[1].Completed || e2.Days[2].Completed {
		t.Errorf("h2 days completed = %v/%v/%v, want false/true/false", e2.Days[0].Completed, e2.Days[1].Completed, e2.Days[2].Completed)
	}
}

func TestCompletionsInRange_ErrorCase_MissingFromReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000015"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?to=2026-03-18", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] == "" {
		t.Error(`400 response should have a non-empty "error" field`)
	}
}

func TestCompletionsInRange_ErrorCase_MissingToReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000016"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=2026-03-18", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCompletionsInRange_ErrorCase_MalformedFromReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000017"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=not-a-date&to=2026-03-18", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCompletionsInRange_ErrorCase_MalformedToReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000018"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=2026-03-18&to=not-a-date", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCompletionsInRange_ErrorCase_FromAfterToReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000019"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=2026-03-20&to=2026-03-18", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCompletionsInRange_ErrorCase_RangeLongerThan31DaysReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000001a"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=2026-01-01&to=2026-02-01", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCompletionsInRange_ErrorCase_UnauthenticatedReturns401(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=2026-03-18&to=2026-03-18"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (no Authorization header)", resp.StatusCode)
	}
}

func TestCompletionsInRange_EdgeCase_NoHabitsReturnsEmptyArray(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000001b"))
	today := time.Now().UTC().Format("2006-01-02")

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=" + today + "&to=" + today, headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.CompletionsRangeResponse](t, resp)
	if len(body.Habits) != 0 {
		t.Errorf("Habits = %v, want empty", body.Habits)
	}
}

func TestCompletionsInRange_EdgeCase_OneDayRange(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000001c"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})
	today := time.Now().UTC().Format("2006-01-02")
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC"},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=" + today + "&to=" + today, headers: a})
	body := decodeBody[habits.CompletionsRangeResponse](t, resp)
	if len(body.Habits) != 1 || len(body.Habits[0].Days) != 1 {
		t.Fatalf("body = %+v, want 1 habit with 1 day", body)
	}
	if !body.Habits[0].Days[0].Completed {
		t.Error("single day should be marked completed")
	}
}

func TestCompletionsInRange_EdgeCase_ThirtyOneDayBoundaryAccepted(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000001d"))
	createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	from := "2026-01-01"
	to := "2026-01-31" // exactly 31 days inclusive
	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=" + from + "&to=" + to, headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 for 31-day boundary", resp.StatusCode)
	}
	body := decodeBody[habits.CompletionsRangeResponse](t, resp)
	if len(body.Habits) != 1 || len(body.Habits[0].Days) != 31 {
		t.Fatalf("Days = %d, want 31", len(body.Habits[0].Days))
	}
}

func TestCompletionsInRange_EdgeCase_ArchivedHabitExcludedEntirely(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "10000000001e"))
	other := bearerFor(t, tokens, newUserID(t, "10000000001f"))
	archived := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Archived"})
	d0 := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + archived.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &d0, Timezone: "UTC"},
	})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + archived.ID, headers: a})
	createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Active"})
	createHabit(t, srv, other, habits.CreateHabitRequest{Name: "Other's Habit"})

	today := time.Now().UTC().Format("2006-01-02")
	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=" + d0 + "&to=" + today, headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.CompletionsRangeResponse](t, resp)
	if len(body.Habits) != 1 || body.Habits[0].Name != "Active" {
		t.Errorf("Habits = %+v, want exactly [Active] (archived excluded entirely even with in-range completions)", body.Habits)
	}
}

func TestCompletionsInRange_EdgeCase_CompletionsOutsideRangeExcluded(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000020"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	before := time.Now().UTC().AddDate(0, 0, -5).Format("2006-01-02")
	inRange := time.Now().UTC().AddDate(0, 0, -2).Format("2006-01-02")
	after := time.Now().UTC().Format("2006-01-02")
	for _, d := range []string{before, inRange, after} {
		doRequest(t, srv, testRequest{
			method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
			body: habits.CompleteHabitRequest{Date: &d, Timezone: "UTC"},
		})
	}

	from := time.Now().UTC().AddDate(0, 0, -3).Format("2006-01-02")
	to := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/completions?from=" + from + "&to=" + to, headers: a})
	body := decodeBody[habits.CompletionsRangeResponse](t, resp)
	if len(body.Habits) != 1 || len(body.Habits[0].Days) != 3 {
		t.Fatalf("body = %+v, want 1 habit with 3 days", body)
	}
	completedCount := 0
	for _, day := range body.Habits[0].Days {
		if day.Completed {
			completedCount++
			if day.Date != inRange {
				t.Errorf("completed day = %s, want only %s (outside-range completions excluded)", day.Date, inRange)
			}
		}
	}
	if completedCount != 1 {
		t.Errorf("completedCount = %d, want 1", completedCount)
	}
}

// --- Timezone edge cases: DST-observing zones and date-line offsets ---
//
// The service has no injectable clock, so a test cannot deterministically
// land on a literal DST transition instant; these tests instead prove the
// two properties that actually matter for correctness: (1) an explicit
// date completed in a DST-observing zone round-trips to the exact
// requested calendar date (no drift from the wall-clock discontinuity
// within that day, because LocalDate arithmetic never touches
// time-of-day), and (2) IANA zones at both extremes of the International
// Date Line load and complete successfully (guards against the embedded
// tzdata database being incomplete for +14/-12 offsets).

func TestCompleteHabit_EdgeCase_DSTObservingZoneRoundTripsExactDate(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "100000000021"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	// "Yesterday in UTC" is always on-or-before "today" in every
	// timezone behind UTC (including all of America/*), so this can
	// never trip the future-date rejection regardless of DST offset,
	// while still exercising a DST-observing zone's local-date handling.
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &yesterday, Timezone: "America/New_York"},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["localDate"] != yesterday {
		t.Errorf("localDate = %v, want %s (must not drift across the DST-observing zone's wall clock)", body["localDate"], yesterday)
	}
}

func TestCompleteHabit_EdgeCase_DateLineTimezonesAreAccepted(t *testing.T) {
	t.Parallel()
	for _, tz := range []string{
		"Pacific/Kiritimati", // UTC+14, the easternmost IANA zone
		"Etc/GMT+12",         // UTC-12, the westernmost side of the date line
	} {
		t.Run(tz, func(t *testing.T) {
			srv, tokens, _ := newTestServer(t)
			a := bearerFor(t, tokens, newUserID(t, "100000000022"))
			created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

			resp := doRequest(t, srv, testRequest{
				method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
				body: habits.CompleteHabitRequest{Timezone: tz},
			})
			if resp.StatusCode != http.StatusCreated {
				t.Errorf("status = %d, want 201 for IANA zone %s", resp.StatusCode, tz)
			}
		})
	}
}
