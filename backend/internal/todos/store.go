package todos

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrNotFound = errors.New("todos: not found")

// ErrStaleOrder is returned when PUT /todos/order receives a valid but
// incomplete set of the caller's open todo IDs.
var ErrStaleOrder = errors.New("todos: stale order")

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const todoColumns = `id::text, created_at, updated_at, user_id::text, title, due_date, position, completed_at`

func scanTodo(row pgx.Row) (Todo, error) {
	var t Todo
	err := row.Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt, &t.UserID, &t.Title, &t.DueDate, &t.Position, &t.CompletedAt)
	return t, err
}

func createTodo(ctx context.Context, db querier, userID, title string, dueDate *time.Time) (Todo, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO todos (user_id, title, due_date, position)
		SELECT $1::uuid, $2, $3, COALESCE(MAX(position), -1) + 1
		FROM todos WHERE user_id = $1::uuid
		RETURNING `+todoColumns,
		userID, title, dueDate)

	t, err := scanTodo(row)
	if err != nil {
		return Todo{}, fmt.Errorf("todos: inserting todo: %w", err)
	}
	return t, nil
}

func listTodos(ctx context.Context, db querier, userID, status string) ([]Todo, error) {
	var query string
	switch status {
	case "completed":
		query = `
			SELECT ` + todoColumns + ` FROM todos
			WHERE user_id = $1::uuid AND completed_at IS NOT NULL
			ORDER BY completed_at DESC, id`
	case "all":
		query = `
			SELECT ` + todoColumns + ` FROM todos
			WHERE user_id = $1::uuid
			ORDER BY (completed_at IS NOT NULL),
				CASE WHEN completed_at IS NULL THEN position END,
				completed_at DESC,
				id`
	default: // open
		query = `
			SELECT ` + todoColumns + ` FROM todos
			WHERE user_id = $1::uuid AND completed_at IS NULL
			ORDER BY position ASC, id`
	}

	rows, err := db.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("todos: listing todos: %w", err)
	}
	defer rows.Close()

	result := []Todo{}
	for rows.Next() {
		t, err := scanTodo(rows)
		if err != nil {
			return nil, fmt.Errorf("todos: scanning todo: %w", err)
		}
		result = append(result, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("todos: iterating todos: %w", err)
	}
	return result, nil
}

func findTodo(ctx context.Context, db querier, userID, id string) (Todo, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+todoColumns+` FROM todos
		WHERE id = $1::uuid AND user_id = $2::uuid`,
		id, userID)
	t, err := scanTodo(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Todo{}, false, nil
	}
	if err != nil {
		return Todo{}, false, fmt.Errorf("todos: finding todo: %w", err)
	}
	return t, true, nil
}

func updateTodo(ctx context.Context, db querier, t Todo) (Todo, error) {
	row := db.QueryRow(ctx, `
		UPDATE todos SET title = $2, due_date = $3, updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+todoColumns,
		t.ID, t.Title, t.DueDate)

	updated, err := scanTodo(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Todo{}, ErrNotFound
	}
	if err != nil {
		return Todo{}, fmt.Errorf("todos: updating todo: %w", err)
	}
	return updated, nil
}

func completeTodo(ctx context.Context, db querier, id string) (Todo, error) {
	row := db.QueryRow(ctx, `
		UPDATE todos SET completed_at = COALESCE(completed_at, now()), updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+todoColumns,
		id)

	t, err := scanTodo(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Todo{}, ErrNotFound
	}
	if err != nil {
		return Todo{}, fmt.Errorf("todos: completing todo: %w", err)
	}
	return t, nil
}

func uncompleteTodo(ctx context.Context, db querier, userID, id string) (Todo, error) {
	row := db.QueryRow(ctx, `
		WITH next_pos AS (
			SELECT COALESCE(MAX(position), -1) + 1 AS p
			FROM todos
			WHERE user_id = $1::uuid AND completed_at IS NULL
		)
		UPDATE todos SET
			completed_at = NULL,
			position = (SELECT p FROM next_pos),
			updated_at = now()
		WHERE id = $2::uuid AND user_id = $1::uuid
		RETURNING `+todoColumns,
		userID, id)

	t, err := scanTodo(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Todo{}, ErrNotFound
	}
	if err != nil {
		return Todo{}, fmt.Errorf("todos: uncompleting todo: %w", err)
	}
	return t, nil
}

func deleteTodo(ctx context.Context, db querier, userID, id string) (bool, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM todos WHERE id = $1::uuid AND user_id = $2::uuid`,
		id, userID)
	if err != nil {
		return false, fmt.Errorf("todos: deleting todo: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func listOpenTodoIDs(ctx context.Context, db querier, userID string) ([]string, error) {
	rows, err := db.Query(ctx, `
		SELECT id::text FROM todos
		WHERE user_id = $1::uuid AND completed_at IS NULL
		ORDER BY position ASC, id`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("todos: listing open todo ids: %w", err)
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("todos: scanning open todo id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("todos: iterating open todo ids: %w", err)
	}
	return ids, nil
}

func setTodoPositions(ctx context.Context, db querier, userID string, todoIDs []string) error {
	for i, id := range todoIDs {
		tag, err := db.Exec(ctx, `
			UPDATE todos SET position = $3, updated_at = now()
			WHERE id = $1::uuid AND user_id = $2::uuid AND completed_at IS NULL`,
			id, userID, i)
		if err != nil {
			return fmt.Errorf("todos: setting position: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrStaleOrder
		}
	}
	return nil
}

func deleteUserData(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM todos WHERE user_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("todos: deleting user todos: %w", err)
	}
	return nil
}

func listAllTodosForUser(ctx context.Context, db querier, userID string) ([]Todo, error) {
	rows, err := db.Query(ctx, `
		SELECT `+todoColumns+` FROM todos
		WHERE user_id = $1::uuid
		ORDER BY created_at`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("todos: listing all todos for export: %w", err)
	}
	defer rows.Close()

	result := []Todo{}
	for rows.Next() {
		t, err := scanTodo(rows)
		if err != nil {
			return nil, fmt.Errorf("todos: scanning todo for export: %w", err)
		}
		result = append(result, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("todos: iterating todos for export: %w", err)
	}
	return result, nil
}
