//go:build integration

// Package habits_test's export suite proves exportSection's registered
// "habit" section (singular — export.go; see service.go's NewService doc
// comment for why this differs from the module/package name) — the
// in-process replacement for the old GET /habits/internal/export/{userId}
// endpoint — matches InternalExport's shape plus the promises gap-fill (PM
// REVIEW ADDENDUM on winzy.ai-rdc7.3.3).
package habits_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

func TestExportSection_HappyPath_IncludesHabitsCompletionsAndPromises(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, exportReg := newTestServerWithAuth(t)
	reg := registerUserViaService(t, authService, "exporthappy1@example.com", "exporthappy1")
	userID := reg.User.ID
	a := bearerFor(t, tokens, userID)

	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	completeResp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/complete", headers: a,
		body: habits.CompleteHabitRequest{Timezone: "UTC"},
	})
	if completeResp.StatusCode != http.StatusCreated {
		t.Fatalf("completing habit: status = %d, want 201", completeResp.StatusCode)
	}
	promiseResp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), PrivateNote: strPtr("owner-only note")},
	})
	if promiseResp.StatusCode != http.StatusCreated {
		t.Fatalf("creating promise: status = %d, want 201", promiseResp.StatusCode)
	}

	services, warnings := exportReg.Export(context.Background(), userID)
	if len(warnings) != 0 {
		t.Fatalf("warnings = %v, want none", warnings)
	}

	var found bool
	for _, svc := range services {
		if svc.Service != "habit" {
			continue
		}
		found = true
	}
	if !found {
		t.Fatalf("services = %+v, want a \"habit\" section", services)
	}

	exported := habitsExportSection(t, exportReg, userID)
	if len(exported) != 1 {
		t.Fatalf("exported habits = %d, want 1", len(exported))
	}
	if len(exported[0].Promises) != 1 {
		t.Fatalf("exported promises = %d, want 1", len(exported[0].Promises))
	}
	if exported[0].Promises[0].Status != "active" {
		t.Errorf("exported promise Status = %q, want active", exported[0].Promises[0].Status)
	}
}

// TestExportSection_EdgeCase_NoHabitsOmitsSectionSilently proves a user with
// zero habits gets no "habit" entry in services AND no warning — matching
// export.ErrNoData's contract (see registry.go) and the OLD orchestrator's
// own handling of a downstream 404 (AuthEndpoints.cs's ExportData: a 404
// from a service's own /internal/export/{userId} is `Failed: false`, never
// surfaced as a warning). This replaces an earlier, incorrect version of
// this test that asserted a warning WAS present — that pinned exportSection
// returning ErrNotFound, which produced "Failed to export data from habit"
// for the ordinary, expected case of a brand-new user with no habits yet;
// the old system never emitted anything for that case at all.
func TestExportSection_EdgeCase_NoHabitsOmitsSectionSilently(t *testing.T) {
	t.Parallel()
	_, _, _, authService, exportReg := newTestServerWithAuth(t)
	reg := registerUserViaService(t, authService, "exportnohabits1@example.com", "exportnohabits1")

	services, warnings := exportReg.Export(context.Background(), reg.User.ID)
	for _, svc := range services {
		if svc.Service == "habit" {
			t.Errorf("services contains a \"habit\" entry for a user with no habits: %+v", svc)
		}
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want none (a zero-habit export is not a failure)", warnings)
	}
}

// exportedCompletionBatch/exportedPromiseBatch/exportedHabitBatch decode
// export.go's completionExport/promiseExport/habitExport JSON shape with
// the extra fields TestExportSection_HappyPath_BatchedQueriesPreservePerHabitOrdering
// needs — distinct from exportedHabit/exportedPromise in
// promise_archive_integration_test.go (which only need habitId/promiseId/
// status) so that test's shape stays untouched by this one's needs.
type exportedCompletionBatch struct {
	CompletionID string `json:"completionId"`
	LocalDate    string `json:"localDate"`
}

type exportedPromiseBatch struct {
	PromiseID         string  `json:"promiseId"`
	TargetConsistency float64 `json:"targetConsistency"`
}

type exportedHabitBatch struct {
	HabitID     string                    `json:"habitId"`
	Name        string                    `json:"name"`
	Completions []exportedCompletionBatch `json:"completions"`
	Promises    []exportedPromiseBatch    `json:"promises"`
}

// habitsExportSectionBatch is habitsExportSection's decode step against
// exportedHabitBatch instead of exportedHabit — see that type's doc comment.
func habitsExportSectionBatch(t *testing.T, exportReg *export.Registry, userID string) []exportedHabitBatch {
	t.Helper()
	services, _ := exportReg.Export(context.Background(), userID)
	for _, svc := range services {
		if svc.Service != "habit" {
			continue
		}
		raw, err := json.Marshal(svc.Data)
		if err != nil {
			t.Fatalf("marshaling habit export data: %v", err)
		}
		var decoded struct {
			Habits []exportedHabitBatch `json:"habits"`
		}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatalf("unmarshaling habit export data: %v", err)
		}
		return decoded.Habits
	}
	t.Fatal(`export services has no "habit" section`)
	return nil
}

func daysAgoISODate(days int) string {
	return time.Now().UTC().AddDate(0, 0, -days).Format("2006-01-02")
}

// TestExportSection_HappyPath_BatchedQueriesPreservePerHabitOrdering proves
// exportSection's batched completions/promises fetch (winzy.ai-vz0i:
// batchCompletionsForExport/batchPromisesForExport, WHERE habit_id =
// ANY($1::uuid[]) instead of one query per habit) still attaches each
// completion/promise to the RIGHT habit and preserves the exact ordering
// the old per-habit queries produced (local_date for completions,
// created_at for promises — see those two functions' doc comments in
// store.go/promise_store.go). Three habits are completed/promised in
// deliberately interleaved, non-chronological order across habits, so a
// grouping bug (wrong habit) or an ordering bug (missing habit_id as the
// primary ORDER BY key) would both show up as a mismatch here, not just
// happen to look right from insertion order alone.
func TestExportSection_HappyPath_BatchedQueriesPreservePerHabitOrdering(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, exportReg := newTestServerWithAuth(t)
	reg := registerUserViaService(t, authService, "exportbatch1@example.com", "exportbatch1")
	userID := reg.User.ID
	a := bearerFor(t, tokens, userID)

	habitA := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Alpha"})
	habitB := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Beta"})
	habitC := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Gamma"})

	completeOn := func(habitID string, daysAgo int) {
		date := daysAgoISODate(daysAgo)
		resp := doRequest(t, srv, testRequest{
			method: http.MethodPost, path: "/habits/" + habitID + "/complete", headers: a,
			body: habits.CompleteHabitRequest{Date: &date, Timezone: "UTC"},
		})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("completing habit %s on %s: status = %d, want 201", habitID, date, resp.StatusCode)
		}
	}
	// Interleaved across habits AND out of chronological order within each
	// habit's own completions.
	completeOn(habitA.ID, 10)
	completeOn(habitB.ID, 7)
	completeOn(habitA.ID, 1)
	completeOn(habitC.ID, 3)
	completeOn(habitB.ID, 2)
	completeOn(habitA.ID, 5)
	completeOn(habitC.ID, 8)

	// Give each habit two promises (create, cancel, create again) so
	// per-habit created_at ordering is actually exercised, not just a
	// single-row group.
	createPromise := func(habitID string, target float64) {
		resp := doRequest(t, srv, testRequest{
			method: http.MethodPost, path: "/habits/" + habitID + "/promise", headers: a,
			body: habits.CreatePromiseRequest{TargetConsistency: target, EndDate: futureDate(30)},
		})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("creating promise on habit %s: status = %d, want 201", habitID, resp.StatusCode)
		}
	}
	cancelPromise := func(habitID string) {
		resp := doRequest(t, srv, testRequest{
			method: http.MethodDelete, path: "/habits/" + habitID + "/promise", headers: a,
		})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("cancelling promise on habit %s: status = %d, want 204", habitID, resp.StatusCode)
		}
	}
	for _, h := range []habits.HabitResponse{habitA, habitB, habitC} {
		createPromise(h.ID, 50)
		cancelPromise(h.ID)
		createPromise(h.ID, 90)
	}

	exported := habitsExportSectionBatch(t, exportReg, userID)
	if len(exported) != 3 {
		t.Fatalf("exported habits = %d, want 3", len(exported))
	}

	byName := make(map[string]exportedHabitBatch, len(exported))
	for _, h := range exported {
		byName[h.Name] = h
	}

	wantCompletionDates := map[string][]string{
		"Alpha": {daysAgoISODate(10), daysAgoISODate(5), daysAgoISODate(1)},
		"Beta":  {daysAgoISODate(7), daysAgoISODate(2)},
		"Gamma": {daysAgoISODate(8), daysAgoISODate(3)},
	}
	for name, wantDates := range wantCompletionDates {
		h, ok := byName[name]
		if !ok {
			t.Fatalf("exported habits missing %q: %+v", name, exported)
		}
		if len(h.Completions) != len(wantDates) {
			t.Fatalf("%s completions = %d, want %d (got %+v)", name, len(h.Completions), len(wantDates), h.Completions)
		}
		for i, want := range wantDates {
			if got := h.Completions[i].LocalDate; got != want {
				t.Errorf("%s completions[%d].LocalDate = %q, want %q (full = %+v)", name, i, got, want, h.Completions)
			}
		}
		if len(h.Promises) != 2 {
			t.Fatalf("%s promises = %d, want 2 (got %+v)", name, len(h.Promises), h.Promises)
		}
		if h.Promises[0].TargetConsistency != 50 || h.Promises[1].TargetConsistency != 90 {
			t.Errorf("%s promises order = %+v, want TargetConsistency [50, 90] (created_at order)", name, h.Promises)
		}
	}
}
