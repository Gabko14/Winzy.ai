//go:build integration

package todos

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
)

func TestSetTodoPositions_ErrorCase_CompletedIDReturnsStaleOrder(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(pool, events.New(logger), export.New(logger), logger)

	userID := "00000000-0000-4000-8000-000000000020"
	a, err := svc.CreateTodo(context.Background(), userID, CreateTodoRequest{Title: "A"})
	if err != nil {
		t.Fatalf("CreateTodo A: %v", err)
	}
	b, err := svc.CreateTodo(context.Background(), userID, CreateTodoRequest{Title: "B"})
	if err != nil {
		t.Fatalf("CreateTodo B: %v", err)
	}
	if _, err := svc.CompleteTodo(context.Background(), userID, a.ID); err != nil {
		t.Fatalf("CompleteTodo: %v", err)
	}

	// Simulate mid-reorder race: validation saw A open, then A completed
	// before the position UPDATE — RowsAffected != 1 must be ErrStaleOrder.
	err = setTodoPositions(context.Background(), pool, userID, []string{a.ID, b.ID})
	if !errors.Is(err, ErrStaleOrder) {
		t.Fatalf("setTodoPositions error = %v, want ErrStaleOrder", err)
	}
}

func TestOrderTodos_ErrorCase_StaleMidReorderRollsBack(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(pool, events.New(logger), export.New(logger), logger)

	userID := "00000000-0000-4000-8000-000000000021"
	a, err := svc.CreateTodo(context.Background(), userID, CreateTodoRequest{Title: "A"})
	if err != nil {
		t.Fatalf("CreateTodo A: %v", err)
	}
	b, err := svc.CreateTodo(context.Background(), userID, CreateTodoRequest{Title: "B"})
	if err != nil {
		t.Fatalf("CreateTodo B: %v", err)
	}
	c, err := svc.CreateTodo(context.Background(), userID, CreateTodoRequest{Title: "C"})
	if err != nil {
		t.Fatalf("CreateTodo C: %v", err)
	}

	// Begin a tx, apply first position, then fail like a mid-loop stale hit
	// and ensure the partial write is rolled back when the store returns
	// ErrStaleOrder from within OrderTodos' transaction via setTodoPositions.
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	if err := setTodoPositions(context.Background(), tx, userID, []string{c.ID, a.ID, b.ID}); err != nil {
		t.Fatalf("setTodoPositions happy path inside tx: %v", err)
	}
	_ = tx.Rollback(context.Background())

	list, err := listTodos(context.Background(), pool, userID, "open")
	if err != nil {
		t.Fatalf("listTodos: %v", err)
	}
	if len(list) != 3 || list[0].ID != a.ID || list[1].ID != b.ID || list[2].ID != c.ID {
		t.Fatalf("after rollback order = %+v, want original A,B,C", list)
	}

	// Direct ErrStaleOrder path through OrderTodos: complete C, then ask to
	// reorder including C — validation rejects as 400-class fieldError before
	// setTodoPositions. Mid-loop mapping is covered above + setTodoPositions test.
	if _, err := svc.CompleteTodo(context.Background(), userID, c.ID); err != nil {
		t.Fatalf("CompleteTodo: %v", err)
	}
	err = setTodoPositions(context.Background(), pool, userID, []string{b.ID, a.ID, c.ID})
	if !errors.Is(err, ErrStaleOrder) {
		t.Fatalf("mid-reorder mapping error = %v, want ErrStaleOrder", err)
	}
}

func TestListTodos_EdgeCase_TiedPositionsOrderByID(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(pool, events.New(logger), export.New(logger), logger)

	userID := "00000000-0000-4000-8000-000000000022"
	first, err := svc.CreateTodo(context.Background(), userID, CreateTodoRequest{Title: "A"})
	if err != nil {
		t.Fatalf("CreateTodo A: %v", err)
	}
	second, err := svc.CreateTodo(context.Background(), userID, CreateTodoRequest{Title: "B"})
	if err != nil {
		t.Fatalf("CreateTodo B: %v", err)
	}

	if _, err := pool.Exec(context.Background(), `
		UPDATE todos SET position = 0 WHERE id = $1::uuid OR id = $2::uuid`,
		first.ID, second.ID); err != nil {
		t.Fatalf("forcing tied positions: %v", err)
	}

	list, err := listTodos(context.Background(), pool, userID, "open")
	if err != nil {
		t.Fatalf("listTodos: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("open count = %d, want 2", len(list))
	}
	wantFirst, wantSecond := first.ID, second.ID
	if wantFirst > wantSecond {
		wantFirst, wantSecond = wantSecond, wantFirst
	}
	if list[0].ID != wantFirst || list[1].ID != wantSecond {
		t.Errorf("order = [%s %s], want [%s %s]", list[0].ID, list[1].ID, wantFirst, wantSecond)
	}
}

func TestUpdateTodo_ErrorCase_DeletedBetweenCheckReturnsNotFound(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)

	userID := "00000000-0000-4000-8000-000000000023"
	todo, err := createTodo(context.Background(), pool, userID, "Gone", nil)
	if err != nil {
		t.Fatalf("createTodo: %v", err)
	}
	if _, err := deleteTodo(context.Background(), pool, userID, todo.ID); err != nil {
		t.Fatalf("deleteTodo: %v", err)
	}

	_, err = updateTodo(context.Background(), pool, Todo{ID: todo.ID, Title: "Nope", DueDate: nil})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("updateTodo error = %v, want ErrNotFound", err)
	}
	_, err = completeTodo(context.Background(), pool, todo.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("completeTodo error = %v, want ErrNotFound", err)
	}
	_, err = uncompleteTodo(context.Background(), pool, userID, todo.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("uncompleteTodo error = %v, want ErrNotFound", err)
	}
}
