//go:build integration

package habits_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

// --- GET /habits/stats (batch) ---

func TestBatchStats_HappyPath_MatchesPerHabitExactly(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "210000000001"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise", MinimumDescription: strPtr("walk")})
	h2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Read"})
	h3 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Meditate"})

	today := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	minimum := habits.CompletionMinimum
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + h1.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC", CompletionKind: &minimum},
	})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + h2.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &yesterday, Timezone: "UTC"},
	})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + h2.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Date: &today, Timezone: "UTC"},
	})
	// h3 left incomplete

	batchResp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/stats",
		headers: mergeHeaders(a, map[string]string{"X-Timezone": "UTC"}),
	})
	if batchResp.StatusCode != http.StatusOK {
		t.Fatalf("batch status = %d, want 200", batchResp.StatusCode)
	}
	batch := decodeBody[[]habits.HabitStatsResponse](t, batchResp)
	if len(batch) != 3 {
		t.Fatalf("batch len = %d, want 3", len(batch))
	}

	byID := map[string]habits.HabitStatsResponse{}
	for _, s := range batch {
		byID[s.HabitID] = s
	}
	for _, id := range []string{h1.ID, h2.ID, h3.ID} {
		per := getStatsTyped(t, srv, a, id, "UTC")
		got, ok := byID[id]
		if !ok {
			t.Fatalf("batch missing habit %s", id)
		}
		if !reflect.DeepEqual(got, per) {
			gotJSON, _ := json.Marshal(got)
			perJSON, _ := json.Marshal(per)
			t.Errorf("batch vs per-habit mismatch for %s:\n batch=%s\n per=%s", id, gotJSON, perJSON)
		}
	}
}

func TestBatchStats_EdgeCase_ZeroHabitsReturnsEmptyArray(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "210000000002"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/stats",
		headers: mergeHeaders(a, map[string]string{"X-Timezone": "UTC"}),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[[]habits.HabitStatsResponse](t, resp)
	if body == nil || len(body) != 0 {
		t.Errorf("body = %#v, want empty non-nil array", body)
	}
}

func TestBatchStats_EdgeCase_ExcludesArchivedHabits(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "210000000003"))
	active := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Active"})
	archived := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Archived"})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + archived.ID, headers: a})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/stats",
		headers: mergeHeaders(a, map[string]string{"X-Timezone": "UTC"}),
	})
	batch := decodeBody[[]habits.HabitStatsResponse](t, resp)
	if len(batch) != 1 || batch[0].HabitID != active.ID {
		t.Fatalf("batch = %+v, want only active habit", batch)
	}
}

func TestBatchStats_ErrorCase_MissingTimezoneHeaderReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "210000000004"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/stats", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "X-Timezone header is required" {
		t.Errorf("error = %v, want 'X-Timezone header is required'", body["error"])
	}
}

func TestBatchStats_ErrorCase_UnauthenticatedReturns401(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/habits/stats",
		headers: map[string]string{"X-Timezone": "UTC"},
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func getStatsTyped(t *testing.T, srv *httptest.Server, a map[string]string, habitID, tz string) habits.HabitStatsResponse {
	t.Helper()
	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/habits/" + habitID + "/stats",
		headers: mergeHeaders(a, map[string]string{"X-Timezone": tz}),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stats status = %d, want 200", resp.StatusCode)
	}
	return decodeBody[habits.HabitStatsResponse](t, resp)
}
