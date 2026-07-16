//go:build integration

// Package auth_test's cascade suite proves the winzy.ai-rdc7.13 guarantee:
// DeleteAccount's transaction and every registered UserDeleted handler that
// resolves its querier via db.QuerierFrom (see internal/events' package doc)
// commit or roll back together. It follows the same dbtest recipe as
// testserver_integration_test.go but calls auth.Service and habits.Service
// directly rather than through HTTP — the guarantee under test spans two
// modules and has no single endpoint that exercises it end to end.
package auth_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

// newCascadeFixture wires an auth.Service and a habits.Service against the
// same pool and event registry, mirroring cmd/api/main.go's wiring: by the
// time this returns, habits.NewService has already registered its
// UserDeleted handler, so a test-added handler registered afterward runs
// after habits' cascade.
func newCascadeFixture(t *testing.T) (*auth.Service, *habits.Service, *events.Registry, *pgxpool.Pool) {
	t.Helper()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tokens, err := auth.NewTokenService(testJWTSecret, 15, 7)
	if err != nil {
		t.Fatalf("auth.NewTokenService() returned unexpected error: %v", err)
	}

	registry := events.New(logger)
	exportRegistry := export.New(logger)
	authSvc := auth.NewService(pool, tokens, registry, exportRegistry, logger)
	habitsSvc := habits.NewService(pool, registry, exportRegistry, logger)

	return authSvc, habitsSvc, registry, pool
}

func registerViaService(t *testing.T, svc *auth.Service, email, username string) auth.AuthResult {
	t.Helper()
	result, err := svc.Register(context.Background(), email, username, "Password123!", nil)
	if err != nil {
		t.Fatalf("Register(%s) returned unexpected error: %v", email, err)
	}
	return result
}

func createHabitViaService(t *testing.T, svc *habits.Service, userID string) habits.Habit {
	t.Helper()
	habit, err := svc.CreateHabit(context.Background(), userID, habits.CreateHabitRequest{Name: "Read"})
	if err != nil {
		t.Fatalf("CreateHabit() returned unexpected error: %v", err)
	}
	return habit
}

func completeHabitViaService(t *testing.T, svc *habits.Service, userID, habitID string) habits.Completion {
	t.Helper()
	completion, _, err := svc.CompleteHabit(context.Background(), userID, habitID, habits.CompleteHabitRequest{Timezone: "UTC"})
	if err != nil {
		t.Fatalf("CompleteHabit() returned unexpected error: %v", err)
	}
	return completion
}

func TestDeleteAccount_ErrorCase_FailingCascadeHandlerRollsBackAccountAndHabitsTogether(t *testing.T) {
	t.Parallel()
	authSvc, habitsSvc, registry, pool := newCascadeFixture(t)

	reg := registerViaService(t, authSvc, "cascade-rollback@example.com", "cascaderollback")
	habit := createHabitViaService(t, habitsSvc, reg.User.ID)
	completion := completeHabitViaService(t, habitsSvc, reg.User.ID, habit.ID)

	// Registered after habits' own handler (habits.NewService above already
	// registered it), so habits' cascade runs and writes through the shared
	// transaction FIRST, and only then does this handler fail — proving a
	// later handler's failure unwinds an earlier handler's writes too, not
	// just its own. Before winzy.ai-rdc7.13, habits wrote over its own pool
	// connection and this failure would have left the habit/completion
	// rows deleted even though the user row survived.
	wantErr := errors.New("simulated downstream cascade failure")
	events.Register(registry, events.Handler[events.UserDeleted](func(_ context.Context, _ events.UserDeleted) error {
		return wantErr
	}))

	err := authSvc.DeleteAccount(context.Background(), reg.User.ID)
	if !errors.Is(err, wantErr) {
		t.Fatalf("DeleteAccount() error = %v, want it to wrap %v", err, wantErr)
	}

	if !dbtest.RowExists(t, pool, "users", reg.User.ID) {
		t.Error("user row was deleted despite a failing cascade handler; the account-delete transaction should have rolled back")
	}
	if !dbtest.RowExists(t, pool, "habits", habit.ID) {
		t.Error("habit row was deleted despite a failing cascade handler; habits' cascade should have rolled back with the account delete")
	}
	if !dbtest.RowExists(t, pool, "completions", completion.ID) {
		t.Error("completion row was deleted despite a failing cascade handler; habits' cascade should have rolled back with the account delete")
	}
}

func TestDeleteAccount_HappyPath_CommitDeletesAccountAndHabitsCascadeTogether(t *testing.T) {
	t.Parallel()
	authSvc, habitsSvc, _, pool := newCascadeFixture(t)

	reg := registerViaService(t, authSvc, "cascade-commit@example.com", "cascadecommit")
	habit := createHabitViaService(t, habitsSvc, reg.User.ID)
	completion := completeHabitViaService(t, habitsSvc, reg.User.ID, habit.ID)

	if err := authSvc.DeleteAccount(context.Background(), reg.User.ID); err != nil {
		t.Fatalf("DeleteAccount() returned unexpected error: %v", err)
	}

	if dbtest.RowExists(t, pool, "users", reg.User.ID) {
		t.Error("user row survived a successful DeleteAccount")
	}
	if dbtest.RowExists(t, pool, "habits", habit.ID) {
		t.Error("habit row survived a successful DeleteAccount; habits' cascade should have committed along with it")
	}
	if dbtest.RowExists(t, pool, "completions", completion.ID) {
		t.Error("completion row survived a successful DeleteAccount; habits' cascade should have committed along with it")
	}
}
