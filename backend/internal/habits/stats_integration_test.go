//go:build integration

package habits_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

// --- GET /habits/{id}/stats ---

func TestStats_ErrorCase_MissingTimezoneHeaderReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000001"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/" + created.ID + "/stats", headers: a,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "X-Timezone header is required" {
		t.Errorf("error = %v, want 'X-Timezone header is required'", body["error"])
	}
}

func TestStats_ErrorCase_InvalidTimezoneReturns400(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000002"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/" + created.ID + "/stats",
		headers: mergeHeaders(a, map[string]string{"X-Timezone": "Not/A/Zone"}),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "Invalid timezone: Not/A/Zone" {
		t.Errorf("error = %v, want 'Invalid timezone: Not/A/Zone'", body["error"])
	}
}

func TestStats_ErrorCase_NonExistentHabitReturns404(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000003"))

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/habits/" + newUserID(t, "999999999999") + "/stats",
		headers: mergeHeaders(a, map[string]string{"X-Timezone": "UTC"}),
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

// statsResponse mirrors HabitStatsResponse for assertions.
type statsResponse struct {
	HabitID             string  `json:"habitId"`
	Consistency         float64 `json:"consistency"`
	FlameLevel          string  `json:"flameLevel"`
	TotalCompletions    int     `json:"totalCompletions"`
	CompletionsInWindow int     `json:"completionsInWindow"`
	CompletedToday      bool    `json:"completedToday"`
	CompletedTodayKind  *string `json:"completedTodayKind"`
	WindowDays          int     `json:"windowDays"`
	WindowStart         string  `json:"windowStart"`
	Today               string  `json:"today"`
	CompletedDates      []struct {
		Date           string `json:"date"`
		CompletionKind string `json:"completionKind"`
	} `json:"completedDates"`
}

func TestStats_HappyPath_CreatedTodayCompletedTodayReturns100(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000004"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Meditate"})

	// Complete today (habit created today -> 1 applicable day, fully completed).
	completeResp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC"},
	})
	if completeResp.StatusCode != http.StatusCreated {
		t.Fatalf("complete status = %d, want 201", completeResp.StatusCode)
	}
	completeBody := decodeBody[map[string]any](t, completeResp)
	if completeBody["consistency"] != float64(100) {
		t.Errorf("complete response consistency = %v, want 100 (real, not placeholder)", completeBody["consistency"])
	}

	stats := getStats(t, srv, a, created.ID, "UTC")
	if stats.Consistency != 100 {
		t.Errorf("consistency = %v, want 100", stats.Consistency)
	}
	if stats.FlameLevel != "blazing" {
		t.Errorf("flameLevel = %q, want blazing", stats.FlameLevel)
	}
	if stats.TotalCompletions != 1 || stats.CompletionsInWindow != 1 {
		t.Errorf("totals = %d/%d, want 1/1", stats.TotalCompletions, stats.CompletionsInWindow)
	}
	if !stats.CompletedToday {
		t.Error("completedToday = false, want true")
	}
	if stats.CompletedTodayKind == nil || *stats.CompletedTodayKind != "full" {
		t.Errorf("completedTodayKind = %v, want full", stats.CompletedTodayKind)
	}
	if stats.WindowDays != 60 {
		t.Errorf("windowDays = %d, want 60", stats.WindowDays)
	}
	todayUTC := time.Now().UTC().Format("2006-01-02")
	if stats.Today != todayUTC {
		t.Errorf("today = %q, want %q", stats.Today, todayUTC)
	}
	wantWindowStart := time.Now().UTC().AddDate(0, 0, -59).Format("2006-01-02")
	if stats.WindowStart != wantWindowStart {
		t.Errorf("windowStart = %q, want %q", stats.WindowStart, wantWindowStart)
	}
	if len(stats.CompletedDates) != 1 || stats.CompletedDates[0].CompletionKind != "full" {
		t.Errorf("completedDates = %+v, want one full entry", stats.CompletedDates)
	}
}

// TestStats_BackfilledMinimum_BankersRounding drives the exact banker's-rounding
// midpoint through the endpoint: a single Minimum backfilled 7 days ago on a
// habit created today gives 8 applicable days (backfill rule) with weight 0.5,
// = 0.5/8*100 = 6.25, which must round to 6.2 (not 6.3).
func TestStats_BackfilledMinimum_BankersRounding(t *testing.T) {
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000005"))
	created := createHabit(t, srv, a, habits.CreateHabitRequest{
		Name: "Stretch", MinimumDescription: strptr("one stretch"),
	})

	sevenDaysAgo := time.Now().UTC().AddDate(0, 0, -7).Format("2006-01-02")
	minimum := habits.CompletionMinimum
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + created.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &sevenDaysAgo, Timezone: "UTC", CompletionKind: &minimum},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("complete status = %d, want 201", resp.StatusCode)
	}

	stats := getStats(t, srv, a, created.ID, "UTC")
	if stats.Consistency != 6.2 {
		t.Errorf("consistency = %v, want 6.2 (0.5/8*100=6.25 banker's-rounded down)", stats.Consistency)
	}
	// 6.2% is below the Ember rising threshold (10%), so the flame is None.
	if stats.FlameLevel != "none" {
		t.Errorf("flameLevel = %q, want none (6.2%% < 10%% Ember threshold)", stats.FlameLevel)
	}
	if stats.CompletedToday {
		t.Error("completedToday = true, want false (only a past date completed)")
	}
	if stats.CompletionsInWindow != 1 {
		t.Errorf("completionsInWindow = %d, want 1", stats.CompletionsInWindow)
	}
}

// --- helpers ---

func getStats(t *testing.T, srv *httptest.Server, a map[string]string, habitID, tz string) statsResponse {
	t.Helper()
	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/habits/" + habitID + "/stats",
		headers: mergeHeaders(a, map[string]string{"X-Timezone": tz}),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stats status = %d, want 200", resp.StatusCode)
	}
	return decodeBody[statsResponse](t, resp)
}

func strptr(s string) *string { return &s }

func mergeHeaders(base, extra map[string]string) map[string]string {
	out := make(map[string]string, len(base)+len(extra))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}
