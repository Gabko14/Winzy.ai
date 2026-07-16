//go:build integration

// Package habits_test's archive-cancels-promise suite proves the
// winzy.ai-rdc7.3.3 integration point service.go's ArchiveHabit doc comment
// describes: archiving a habit cancels its active promise in the same
// transaction, matching DeleteHabit in HabitEndpoints.cs (which cancels the
// promise and sets ArchivedAt in one SaveChangesAsync). This is the
// integration point left marked (but unimplemented) by winzy.ai-rdc7.3.1.
package habits_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

// exportedPromise/exportedHabit mirror export.go's unexported
// promiseExport/habitExport JSON shape — encoding/json only needs the field
// tags to match, not the concrete Go type, so this works fine from the
// external habits_test package even though habitExport/promiseExport
// themselves aren't nameable here.
type exportedPromise struct {
	PromiseID string `json:"promiseId"`
	Status    string `json:"status"`
}

type exportedHabit struct {
	HabitID  string            `json:"habitId"`
	Promises []exportedPromise `json:"promises"`
}

// habitsExportSection runs the registered "habit" export.Section (singular
// — see service.go's NewService doc comment on why this differs from the
// module/package name) for userID and decodes it into the shape above. It
// deliberately ignores any warnings from OTHER sections (e.g. "auth", for a
// userID that was never registered through auth.Service — several
// habits-module tests mint an arbitrary id via newUserID rather than
// registering a real user, since the habits module itself has no foreign
// key to a users table; see testserver_integration_test.go's doc comment).
func habitsExportSection(t *testing.T, exportReg *export.Registry, userID string) []exportedHabit {
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
			Habits []exportedHabit `json:"habits"`
		}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatalf("unmarshaling habit export data: %v", err)
		}
		return decoded.Habits
	}
	t.Fatal(`export services has no "habit" section`)
	return nil
}

func TestArchiveHabit_HappyPath_CancelsActivePromise(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, exportReg := newTestServerWithAuth(t)
	userID := newUserID(t, "330000000001")
	a := bearerFor(t, tokens, userID)
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	createResp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("creating promise: status = %d, want 201", createResp.StatusCode)
	}

	archiveResp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID, headers: a})
	if archiveResp.StatusCode != http.StatusNoContent {
		t.Fatalf("archiving habit: status = %d, want 204", archiveResp.StatusCode)
	}

	// GET /habits/{id}/promise now 404s (the habit is archived, and every
	// promise endpoint requires an active habit), so the cancellation is
	// verified through the export section, which reports every promise
	// regardless of the parent habit's archive state.
	exported := habitsExportSection(t, exportReg, userID)
	if len(exported) != 1 || len(exported[0].Promises) != 1 {
		t.Fatalf("exported = %+v, want exactly one habit with exactly one promise", exported)
	}
	if exported[0].Promises[0].Status != "cancelled" {
		t.Errorf("exported promise Status = %q, want cancelled", exported[0].Promises[0].Status)
	}
}

// TestArchiveHabit_EdgeCase_NoActivePromiseStillArchivesSuccessfully proves
// the cancel step is a no-op (not an error) when there is no active promise
// to cancel — matching DeleteHabit's `if (activePromise is not null)` guard
// in HabitEndpoints.cs.
func TestArchiveHabit_EdgeCase_NoActivePromiseStillArchivesSuccessfully(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "330000000002"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID, headers: a})
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

// TestArchiveHabit_EdgeCase_CancelledPromiseDoesNotBlockNothingElse proves
// archiving a habit whose promise was already resolved (not Active) leaves
// that promise's terminal status untouched — the cancel step only ever
// looks at the Active promise, matching findActivePromise's WHERE clause.
func TestArchiveHabit_EdgeCase_AlreadyResolvedPromiseUntouchedByArchive(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, exportReg := newTestServerWithAuth(t)
	userID := newUserID(t, "330000000003")
	a := bearerFor(t, tokens, userID)
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	cancelResp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: a})
	if cancelResp.StatusCode != http.StatusNoContent {
		t.Fatalf("cancelling promise: status = %d, want 204", cancelResp.StatusCode)
	}

	archiveResp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID, headers: a})
	if archiveResp.StatusCode != http.StatusNoContent {
		t.Fatalf("archiving habit: status = %d, want 204", archiveResp.StatusCode)
	}

	exported := habitsExportSection(t, exportReg, userID)
	if len(exported) != 1 || len(exported[0].Promises) != 1 {
		t.Fatalf("exported = %+v, want exactly one habit with exactly one promise", exported)
	}
	if exported[0].Promises[0].Status != "cancelled" {
		t.Errorf("exported promise Status = %q, want cancelled (from the explicit cancel, untouched by archive)", exported[0].Promises[0].Status)
	}
}
