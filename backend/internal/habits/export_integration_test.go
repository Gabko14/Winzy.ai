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
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

func TestExportSection_HappyPath_IncludesHabitsCompletionsAndPromises(t *testing.T) {
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
