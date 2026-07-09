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
	"fmt"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

// rowExists is a raw-SQL existence check independent of the store code
// under test. table is always one of a small hardcoded set of constants
// below, not caller input.
func rowExists(t *testing.T, pool *pgxpool.Pool, table, id string) bool {
	t.Helper()
	var exists bool
	query := fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1::uuid)`, table)
	if err := pool.QueryRow(context.Background(), query, id).Scan(&exists); err != nil {
		t.Fatalf("checking %s row existence: %v", table, err)
	}
	return exists
}

func TestHandleUserDeleted_EdgeCase_NoTransactionInContextFallsBackToPool(t *testing.T) {
	pool := dbtest.Connect(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	registry := events.New(logger)
	svc := habits.NewService(pool, registry, logger)

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

	if rowExists(t, pool, "habits", habit.ID) {
		t.Error("habit row survived UserDeleted with no tx in ctx; the pool fallback should still have deleted it")
	}
	if rowExists(t, pool, "completions", completion.ID) {
		t.Error("completion row survived UserDeleted with no tx in ctx; the pool fallback should still have deleted it")
	}
}
