//go:build integration

// Package habits_test's lazy-resolution suite exercises Service.SetClock
// directly (not through HTTP — a bare habits.Service against a real
// Postgres, mirroring cascade_integration_test.go's pattern) per the SCOPE
// ADDITION on winzy.ai-rdc7.3.3: the parity harness cannot exercise
// Kept/EndedBelow resolution because it requires real time to pass a
// promise's EndDate, so the injectable clock and this file exist
// specifically to prove that path without waiting. lazyResolutionBase
// anchors "now" to TODAY at noon UTC (not a fake calendar date): only
// promise-resolution reads go through Service.now (see service.go's Service.now
// doc comment) — CompleteHabit's own date validation still reads the real
// wall clock directly, so a fake "now" whose calendar date differs from the
// real one would make CompleteHabit reject dates derived from it as
// "in the future". Anchoring to the real day and only ever moving the fake
// clock FORWARD from there (after all CompleteHabit calls are done) avoids
// that entirely.
package habits_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

// newServiceFixture wires a bare habits.Service (no HTTP layer) against a
// real Postgres.
func newServiceFixture(t *testing.T) *habits.Service {
	t.Helper()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return habits.NewService(pool, events.New(logger), export.New(logger), logger)
}

func lazyResolutionBase() time.Time {
	now := time.Now().UTC()
	return time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, time.UTC)
}

func TestGetPromise_HappyPath_LazyResolutionKeptWhenConsistencyMeetsTarget(t *testing.T) {
	t.Parallel()
	svc := newServiceFixture(t)
	base := lazyResolutionBase()
	svc.SetClock(func() time.Time { return base })
	userID := newUserID(t, "310000000001")
	ctx := context.Background()

	habit, err := svc.CreateHabit(ctx, userID, habits.CreateHabitRequest{Name: "Read"})
	if err != nil {
		t.Fatalf("CreateHabit() returned unexpected error: %v", err)
	}
	for i := 0; i < 5; i++ {
		date := base.AddDate(0, 0, -i).Format("2006-01-02")
		if _, _, err := svc.CompleteHabit(ctx, userID, habit.ID, habits.CompleteHabitRequest{Date: &date, Timezone: "UTC"}); err != nil {
			t.Fatalf("CompleteHabit(%s) returned unexpected error: %v", date, err)
		}
	}

	endDate := base.AddDate(0, 0, 2).Format("2006-01-02")
	if _, err := svc.CreatePromise(ctx, userID, habit.ID, habits.CreatePromiseRequest{TargetConsistency: 10, EndDate: endDate}, "UTC"); err != nil {
		t.Fatalf("CreatePromise() returned unexpected error: %v", err)
	}

	// Advance the fake clock past EndDate — the only way this outcome can be
	// observed without waiting for real time to pass. No further
	// CompleteHabit calls happen after this point, so its real-wall-clock
	// date validation is never exercised against this future-looking value.
	svc.SetClock(func() time.Time { return base.AddDate(0, 0, 4) })

	resp, err := svc.GetPromise(ctx, userID, habit.ID, "UTC", true)
	if err != nil {
		t.Fatalf("GetPromise() returned unexpected error: %v", err)
	}
	if resp.Active != nil {
		t.Errorf("Active = %+v, want nil (the expired promise should have resolved)", resp.Active)
	}
	if len(resp.History) != 1 || resp.History[0].Status != "kept" {
		t.Fatalf("History = %+v, want exactly one 'kept' entry", resp.History)
	}
	if resp.History[0].ResolvedAt == nil {
		t.Error("resolved promise should have a non-nil ResolvedAt")
	}
}

func TestGetPromise_HappyPath_LazyResolutionEndedBelowWhenConsistencyMissesTarget(t *testing.T) {
	t.Parallel()
	svc := newServiceFixture(t)
	base := lazyResolutionBase()
	svc.SetClock(func() time.Time { return base })
	userID := newUserID(t, "310000000002")
	ctx := context.Background()

	habit, err := svc.CreateHabit(ctx, userID, habits.CreateHabitRequest{Name: "Read"})
	if err != nil {
		t.Fatalf("CreateHabit() returned unexpected error: %v", err)
	}
	// No completions logged — consistency stays at 0.

	endDate := base.AddDate(0, 0, 2).Format("2006-01-02")
	if _, err := svc.CreatePromise(ctx, userID, habit.ID, habits.CreatePromiseRequest{TargetConsistency: 90, EndDate: endDate}, "UTC"); err != nil {
		t.Fatalf("CreatePromise() returned unexpected error: %v", err)
	}

	svc.SetClock(func() time.Time { return base.AddDate(0, 0, 4) })

	resp, err := svc.GetPromise(ctx, userID, habit.ID, "UTC", true)
	if err != nil {
		t.Fatalf("GetPromise() returned unexpected error: %v", err)
	}
	if resp.Active != nil {
		t.Errorf("Active = %+v, want nil", resp.Active)
	}
	if len(resp.History) != 1 || resp.History[0].Status != "endedbelow" {
		t.Fatalf("History = %+v, want exactly one 'endedbelow' entry", resp.History)
	}
}

// TestGetPromise_EdgeCase_EndDateExactlyTodayDoesNotResolveYet proves the
// resolution comparison is strictly-less-than (EndDate < today), matching
// GetPromise's `if (activePromise.EndDate < today)` in PromiseEndpoints.cs:
// a promise whose EndDate is today is still within its promised period and
// must stay Active.
func TestGetPromise_EdgeCase_EndDateExactlyTodayDoesNotResolveYet(t *testing.T) {
	t.Parallel()
	svc := newServiceFixture(t)
	base := lazyResolutionBase()
	svc.SetClock(func() time.Time { return base })
	userID := newUserID(t, "310000000003")
	ctx := context.Background()

	habit, err := svc.CreateHabit(ctx, userID, habits.CreateHabitRequest{Name: "Read"})
	if err != nil {
		t.Fatalf("CreateHabit() returned unexpected error: %v", err)
	}
	endDate := base.AddDate(0, 0, 2).Format("2006-01-02")
	if _, err := svc.CreatePromise(ctx, userID, habit.ID, habits.CreatePromiseRequest{TargetConsistency: 50, EndDate: endDate}, "UTC"); err != nil {
		t.Fatalf("CreatePromise() returned unexpected error: %v", err)
	}

	// Advance the clock to exactly EndDate (not past it).
	svc.SetClock(func() time.Time { return base.AddDate(0, 0, 2) })

	resp, err := svc.GetPromise(ctx, userID, habit.ID, "UTC", false)
	if err != nil {
		t.Fatalf("GetPromise() returned unexpected error: %v", err)
	}
	if resp.Active == nil {
		t.Fatal("Active = nil, want the promise to still be active on its EndDate")
	}
	if resp.Active.Status != "active" {
		t.Errorf("Active.Status = %q, want active", resp.Active.Status)
	}
}

// TestGetPromise_EdgeCase_OwnerTimezoneAffectsResolutionAcrossTheDateLine
// proves resolution reads "today" in the OWNER's timezone (X-Timezone
// header), not UTC: at a fake "now" of base+2 days, noon UTC, a promise
// whose EndDate is base+2 has already fully elapsed for an owner in
// Pacific/Kiritimati (UTC+14 — local time is already base+3) but is still
// exactly on its EndDate (not yet past it) for an owner in Etc/GMT+12
// (UTC-12 — local time is only base+2, midnight).
func TestGetPromise_EdgeCase_OwnerTimezoneAffectsResolutionAcrossTheDateLine(t *testing.T) {
	t.Parallel()
	svc := newServiceFixture(t)
	ctx := context.Background()
	base := lazyResolutionBase()
	svc.SetClock(func() time.Time { return base })
	endDate := base.AddDate(0, 0, 2).Format("2006-01-02")

	userIDAhead := newUserID(t, "310000000004")
	habitAhead, err := svc.CreateHabit(ctx, userIDAhead, habits.CreateHabitRequest{Name: "Read"})
	if err != nil {
		t.Fatalf("CreateHabit() returned unexpected error: %v", err)
	}
	if _, err := svc.CreatePromise(ctx, userIDAhead, habitAhead.ID, habits.CreatePromiseRequest{TargetConsistency: 50, EndDate: endDate}, "Pacific/Kiritimati"); err != nil {
		t.Fatalf("CreatePromise() returned unexpected error: %v", err)
	}

	userIDBehind := newUserID(t, "310000000005")
	habitBehind, err := svc.CreateHabit(ctx, userIDBehind, habits.CreateHabitRequest{Name: "Read"})
	if err != nil {
		t.Fatalf("CreateHabit() returned unexpected error: %v", err)
	}
	if _, err := svc.CreatePromise(ctx, userIDBehind, habitBehind.ID, habits.CreatePromiseRequest{TargetConsistency: 50, EndDate: endDate}, "Etc/GMT+12"); err != nil {
		t.Fatalf("CreatePromise() returned unexpected error: %v", err)
	}

	svc.SetClock(func() time.Time { return base.AddDate(0, 0, 2) })

	aheadResp, err := svc.GetPromise(ctx, userIDAhead, habitAhead.ID, "Pacific/Kiritimati", true)
	if err != nil {
		t.Fatalf("GetPromise() (ahead-of-UTC owner) returned unexpected error: %v", err)
	}
	if aheadResp.Active != nil {
		t.Errorf("ahead-of-UTC owner: Active = %+v, want nil (already past EndDate in Kiritimati)", aheadResp.Active)
	}
	if len(aheadResp.History) != 1 {
		t.Errorf("ahead-of-UTC owner: History = %+v, want exactly one resolved entry", aheadResp.History)
	}

	behindResp, err := svc.GetPromise(ctx, userIDBehind, habitBehind.ID, "Etc/GMT+12", false)
	if err != nil {
		t.Fatalf("GetPromise() (behind-UTC owner) returned unexpected error: %v", err)
	}
	if behindResp.Active == nil {
		t.Error("behind-UTC owner: Active = nil, want the promise to still be active (EndDate not yet passed in Etc/GMT+12)")
	}
}
