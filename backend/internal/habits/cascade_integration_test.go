//go:build integration

// Package habits_test's cascade fallback test proves the no-transaction
// half of winzy.ai-rdc7.13's contract: when UserDeleted is emitted with no
// transaction in ctx (the emitter never called db.WithQuerier),
// handleUserDeleted's db.QuerierFrom(ctx, s.pool) call falls back to s.pool
// and the cascade still runs correctly. auth.Service.DeleteAccount always
// sets a transaction in ctx before emitting (see internal/auth's cascade
// suite, cascade_integration_test.go, for that path); this test exercises
// Emit directly to cover a caller that doesn't.
package habits_test

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

func TestHandleUserDeleted_EdgeCase_NoTransactionInContextFallsBackToPool(t *testing.T) {
	pool := dbtest.Connect(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	registry := events.New(logger)
	svc := habits.NewService(pool, registry, export.New(logger), logger)

	userID := "11111111-1111-1111-1111-111111111111"
	habit, err := svc.CreateHabit(context.Background(), userID, habits.CreateHabitRequest{Name: "Read"})
	if err != nil {
		t.Fatalf("CreateHabit() returned unexpected error: %v", err)
	}
	completion, _, err := svc.CompleteHabit(context.Background(), userID, habit.ID, habits.CompleteHabitRequest{Timezone: "UTC"})
	if err != nil {
		t.Fatalf("CompleteHabit() returned unexpected error: %v", err)
	}

	// Deliberately a plain background context: no db.WithQuerier call, so
	// handleUserDeleted's db.QuerierFrom(ctx, s.pool) must resolve to the
	// pool fallback rather than panicking or silently doing nothing.
	if err := events.Emit(context.Background(), registry, events.UserDeleted{UserID: userID}); err != nil {
		t.Fatalf("Emit(UserDeleted) with no tx in ctx returned unexpected error: %v", err)
	}

	if dbtest.RowExists(t, pool, "habits", habit.ID) {
		t.Error("habit row survived UserDeleted with no tx in ctx; the pool fallback should still have deleted it")
	}
	if dbtest.RowExists(t, pool, "completions", completion.ID) {
		t.Error("completion row survived UserDeleted with no tx in ctx; the pool fallback should still have deleted it")
	}
}
