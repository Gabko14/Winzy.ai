package todos

import (
	"context"
	"time"

	"github.com/Gabko14/winzy/backend/internal/export"
)

type todoExport struct {
	TodoID      string     `json:"todoId"`
	Title       string     `json:"title"`
	DueDate     *string    `json:"dueDate"`
	Position    int        `json:"position"`
	CompletedAt *time.Time `json:"completedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	list, err := listAllTodosForUser(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, export.ErrNoData
	}

	out := make([]todoExport, len(list))
	for i, t := range list {
		var due *string
		if t.DueDate != nil {
			formatted := formatISODate(*t.DueDate)
			due = &formatted
		}
		out[i] = todoExport{
			TodoID:      t.ID,
			Title:       t.Title,
			DueDate:     due,
			Position:    t.Position,
			CompletedAt: t.CompletedAt,
			CreatedAt:   t.CreatedAt,
			UpdatedAt:   t.UpdatedAt,
		}
	}
	return map[string]any{"todos": out}, nil
}
