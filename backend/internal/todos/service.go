package todos

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isValidUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

// Service is the todos module's business logic.
type Service struct {
	pool     *pgxpool.Pool
	registry *events.Registry
	logger   *slog.Logger
}

// NewService wires a Service, registers its UserDeleted cascade handler, and
// registers the "todos" export section.
func NewService(pool *pgxpool.Pool, registry *events.Registry, exportReg *export.Registry, logger *slog.Logger) *Service {
	s := &Service{pool: pool, registry: registry, logger: logger}
	events.Register(registry, s.handleUserDeleted)
	exportReg.Register("todos", s.exportSection)
	return s
}

func (s *Service) handleUserDeleted(ctx context.Context, event events.UserDeleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	if err := deleteUserData(ctx, q, event.UserID); err != nil {
		return fmt.Errorf("todos: cascading user.deleted: %w", err)
	}
	return nil
}

func (s *Service) CreateTodo(ctx context.Context, userID string, req CreateTodoRequest) (Todo, error) {
	title, err := validateTitle(req.Title)
	if err != nil {
		return Todo{}, err
	}
	due, err := validateDueDate(req.DueDate)
	if err != nil {
		return Todo{}, err
	}
	return createTodo(ctx, s.pool, userID, title, due)
}

func (s *Service) ListTodos(ctx context.Context, userID, status string) ([]Todo, error) {
	switch status {
	case "", "open", "completed", "all":
		if status == "" {
			status = "open"
		}
	default:
		return nil, newFieldError("status must be open, completed, or all")
	}
	return listTodos(ctx, s.pool, userID, status)
}

func (s *Service) UpdateTodo(ctx context.Context, userID, id string, req UpdateTodoRequest) (Todo, error) {
	if !isValidUUID(id) {
		return Todo{}, ErrNotFound
	}
	existing, found, err := findTodo(ctx, s.pool, userID, id)
	if err != nil {
		return Todo{}, err
	}
	if !found {
		return Todo{}, ErrNotFound
	}

	if req.Title != nil {
		title, err := validateTitle(*req.Title)
		if err != nil {
			return Todo{}, err
		}
		existing.Title = title
	}
	if req.DueDate.set {
		due, err := validateDueDate(req.DueDate.value)
		if err != nil {
			return Todo{}, err
		}
		existing.DueDate = due
	}

	return updateTodo(ctx, s.pool, existing)
}

func (s *Service) CompleteTodo(ctx context.Context, userID, id string) (Todo, error) {
	if !isValidUUID(id) {
		return Todo{}, ErrNotFound
	}
	existing, found, err := findTodo(ctx, s.pool, userID, id)
	if err != nil {
		return Todo{}, err
	}
	if !found {
		return Todo{}, ErrNotFound
	}
	if existing.CompletedAt != nil {
		return existing, nil
	}
	return completeTodo(ctx, s.pool, id)
}

func (s *Service) UncompleteTodo(ctx context.Context, userID, id string) (Todo, error) {
	if !isValidUUID(id) {
		return Todo{}, ErrNotFound
	}
	existing, found, err := findTodo(ctx, s.pool, userID, id)
	if err != nil {
		return Todo{}, err
	}
	if !found {
		return Todo{}, ErrNotFound
	}
	if existing.CompletedAt == nil {
		return existing, nil
	}
	return uncompleteTodo(ctx, s.pool, userID, id)
}

func (s *Service) DeleteTodo(ctx context.Context, userID, id string) error {
	if !isValidUUID(id) {
		return ErrNotFound
	}
	deleted, err := deleteTodo(ctx, s.pool, userID, id)
	if err != nil {
		return err
	}
	if !deleted {
		return ErrNotFound
	}
	return nil
}

func (s *Service) OrderTodos(ctx context.Context, userID string, todoIDs []string) error {
	if todoIDs == nil {
		todoIDs = []string{}
	}
	seen := make(map[string]bool, len(todoIDs))
	for _, id := range todoIDs {
		if !isValidUUID(id) || seen[id] {
			return newFieldError("todoIds must be the exact set of your open to-dos")
		}
		seen[id] = true
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("todos: beginning order transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	openIDs, err := listOpenTodoIDs(ctx, tx, userID)
	if err != nil {
		return err
	}
	openSet := make(map[string]bool, len(openIDs))
	for _, id := range openIDs {
		openSet[id] = true
	}

	for _, id := range todoIDs {
		if !openSet[id] {
			return newFieldError("todoIds must be the exact set of your open to-dos")
		}
	}
	if len(todoIDs) != len(openIDs) {
		return ErrStaleOrder
	}

	if err := setTodoPositions(ctx, tx, userID, todoIDs); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("todos: committing order transaction: %w", err)
	}
	return nil
}
