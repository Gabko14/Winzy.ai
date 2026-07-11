//go:build integration

// Package habits' (white-box, not habits_test) store-level suite exercises
// unexported store functions directly against a real Postgres — needed here
// because the status guard resolvePromise/cancelPromiseRow added (see their
// doc comments in promise_store.go) is a race-condition hardening that has
// no natural trigger through the Service's public API: proving it requires
// calling the store layer's UPDATE twice on the same row and observing the
// second call's found=false, which the Service layer never does on its own
// single-threaded call path.
package habits

import (
	"context"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
)

func TestResolvePromise_EdgeCase_StatusGuardPreventsOverwritingATerminalState(t *testing.T) {
	pool := dbtest.Connect(t)
	ctx := context.Background()
	userID := "00000000-0000-4000-8000-000000000001"

	habit, err := createHabit(ctx, pool, userID, CreateHabitRequest{Name: "Read"}, FrequencyDaily, nil)
	if err != nil {
		t.Fatalf("createHabit() returned unexpected error: %v", err)
	}

	endDate := civilDateInLocation(time.Now().AddDate(0, 0, 30), time.UTC)
	promise, err := insertPromise(ctx, pool, Promise{
		UserID:            userID,
		HabitID:           habit.ID,
		TargetConsistency: 50,
		EndDate:           endDate,
		Status:            PromiseActive,
	})
	if err != nil {
		t.Fatalf("insertPromise() returned unexpected error: %v", err)
	}

	now := time.Now().UTC()
	if _, resolved, err := cancelPromiseRow(ctx, pool, promise.ID, now); err != nil || !resolved {
		t.Fatalf("cancelPromiseRow() = (_, %v, %v), want (_, true, nil)", resolved, err)
	}

	// Simulate the race: a lazy-resolution attempt (or a second concurrent
	// cancel) tries to transition the same promise again after it has
	// already left Active — the WHERE status = 'Active' guard must reject
	// this UPDATE rather than overwriting the terminal Cancelled state with
	// Kept.
	p, resolved, err := resolvePromise(ctx, pool, promise.ID, PromiseKept, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("resolvePromise() on an already-terminal promise returned unexpected error: %v", err)
	}
	if resolved {
		t.Errorf("resolvePromise() reported resolved=true (and returned %+v) for a promise that was already Cancelled — the status guard should have rejected it", p)
	}

	history, err := promiseHistory(ctx, pool, userID, habit.ID)
	if err != nil {
		t.Fatalf("promiseHistory() returned unexpected error: %v", err)
	}
	if len(history) != 1 || history[0].Status != PromiseCancelled {
		t.Fatalf("history = %+v, want exactly one Cancelled entry (must NOT have been overwritten to Kept)", history)
	}
}

// TestCancelActivePromiseForArchive_EdgeCase_LostRaceIsANoOp proves the
// archive-cancel integration point (service.go's ArchiveHabit) doesn't
// error when it loses the same race — findActivePromise sees the promise
// as Active, but by the time cancelPromiseRow's UPDATE runs, it has already
// been resolved by something else.
func TestCancelActivePromiseForArchive_EdgeCase_LostRaceIsANoOp(t *testing.T) {
	pool := dbtest.Connect(t)
	ctx := context.Background()
	userID := "00000000-0000-4000-8000-000000000002"

	habit, err := createHabit(ctx, pool, userID, CreateHabitRequest{Name: "Read"}, FrequencyDaily, nil)
	if err != nil {
		t.Fatalf("createHabit() returned unexpected error: %v", err)
	}
	endDate := civilDateInLocation(time.Now().AddDate(0, 0, 30), time.UTC)
	promise, err := insertPromise(ctx, pool, Promise{
		UserID: userID, HabitID: habit.ID, TargetConsistency: 50, EndDate: endDate, Status: PromiseActive,
	})
	if err != nil {
		t.Fatalf("insertPromise() returned unexpected error: %v", err)
	}

	now := time.Now().UTC()
	// Resolve it out from under the archive path first (simulating a
	// concurrent winner), THEN call cancelActivePromiseForArchive as if it
	// had already read this promise as Active before that resolution landed.
	if _, resolved, err := resolvePromise(ctx, pool, promise.ID, PromiseKept, now); err != nil || !resolved {
		t.Fatalf("resolvePromise() setup call = (_, %v, %v), want (_, true, nil)", resolved, err)
	}

	if err := cancelActivePromiseForArchive(ctx, pool, userID, habit.ID, now.Add(time.Hour)); err != nil {
		t.Errorf("cancelActivePromiseForArchive() returned an error for a lost race, want a silent no-op: %v", err)
	}

	history, err := promiseHistory(ctx, pool, userID, habit.ID)
	if err != nil {
		t.Fatalf("promiseHistory() returned unexpected error: %v", err)
	}
	if len(history) != 1 || history[0].Status != PromiseKept {
		t.Fatalf("history = %+v, want exactly one Kept entry (archive must not have overwritten it to Cancelled)", history)
	}
}
