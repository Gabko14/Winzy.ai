//go:build integration

package todos_test

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
	"github.com/Gabko14/winzy/backend/internal/todos"
)

func newCascadeFixture(t *testing.T) (*auth.Service, *todos.Service, *events.Registry, *pgxpool.Pool) {
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
	todosSvc := todos.NewService(pool, registry, exportRegistry, logger)
	return authSvc, todosSvc, registry, pool
}

func TestDeleteAccount_HappyPath_CommitDeletesTodosCascadeTogether(t *testing.T) {
	t.Parallel()
	authSvc, todosSvc, _, pool := newCascadeFixture(t)

	reg, err := authSvc.Register(context.Background(), "todos-cascade@example.com", "todoscascade", "Password123!", nil)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	todo, err := todosSvc.CreateTodo(context.Background(), reg.User.ID, todos.CreateTodoRequest{Title: "Cascade me"})
	if err != nil {
		t.Fatalf("CreateTodo: %v", err)
	}

	if err := authSvc.DeleteAccount(context.Background(), reg.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	if dbtest.RowExists(t, pool, "users", reg.User.ID) {
		t.Error("user row survived DeleteAccount")
	}
	if dbtest.RowExists(t, pool, "todos", todo.ID) {
		t.Error("todo row survived DeleteAccount; todos cascade should have committed with it")
	}
}

func TestDeleteAccount_ErrorCase_FailingCascadeHandlerRollsBackTodosToo(t *testing.T) {
	t.Parallel()
	authSvc, todosSvc, registry, pool := newCascadeFixture(t)

	reg, err := authSvc.Register(context.Background(), "todos-rollback@example.com", "todosrollback", "Password123!", nil)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	todo, err := todosSvc.CreateTodo(context.Background(), reg.User.ID, todos.CreateTodoRequest{Title: "Keep me"})
	if err != nil {
		t.Fatalf("CreateTodo: %v", err)
	}

	wantErr := errors.New("simulated downstream cascade failure")
	events.Register(registry, events.Handler[events.UserDeleted](func(_ context.Context, _ events.UserDeleted) error {
		return wantErr
	}))

	err = authSvc.DeleteAccount(context.Background(), reg.User.ID)
	if !errors.Is(err, wantErr) {
		t.Fatalf("DeleteAccount() error = %v, want wrap of %v", err, wantErr)
	}

	if !dbtest.RowExists(t, pool, "users", reg.User.ID) {
		t.Error("user row was deleted despite failing cascade handler")
	}
	if !dbtest.RowExists(t, pool, "todos", todo.ID) {
		t.Error("todo row was deleted despite failing cascade handler; should have rolled back")
	}
}

func TestHandleUserDeleted_EdgeCase_NoTransactionInContextFallsBackToPool(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	registry := events.New(logger)
	svc := todos.NewService(pool, registry, export.New(logger), logger)

	userID := "11111111-1111-1111-1111-111111111111"
	todo, err := svc.CreateTodo(context.Background(), userID, todos.CreateTodoRequest{Title: "Pool fallback"})
	if err != nil {
		t.Fatalf("CreateTodo: %v", err)
	}

	if err := events.Emit(context.Background(), registry, events.UserDeleted{UserID: userID}); err != nil {
		t.Fatalf("Emit(UserDeleted): %v", err)
	}
	if dbtest.RowExists(t, pool, "todos", todo.ID) {
		t.Error("todo survived UserDeleted with no tx in ctx")
	}
}
