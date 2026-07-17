package todos

import (
	"encoding/json"
	"time"
)

const isoDateLayout = "2006-01-02"

// Todo is the domain row.
type Todo struct {
	ID          string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	UserID      string
	Title       string
	DueDate     *time.Time
	Position    int
	CompletedAt *time.Time
}

// CreateTodoRequest is POST /todos.
type CreateTodoRequest struct {
	Title   string  `json:"title"`
	DueDate *string `json:"dueDate"`
}

// UpdateTodoRequest is PUT /todos/{id}. DueDate uses optionalDate so an
// explicit JSON null clears the date while an omitted field leaves it alone.
type UpdateTodoRequest struct {
	Title   *string      `json:"title"`
	DueDate optionalDate `json:"dueDate"`
}

// OrderTodosRequest is PUT /todos/order.
type OrderTodosRequest struct {
	TodoIDs []string `json:"todoIds"`
}

// TodoResponse is the wire shape for a single todo.
type TodoResponse struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	DueDate     *string    `json:"dueDate"`
	Position    int        `json:"position"`
	CompletedAt *time.Time `json:"completedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

func toTodoResponse(t Todo) TodoResponse {
	var due *string
	if t.DueDate != nil {
		s := formatISODate(*t.DueDate)
		due = &s
	}
	return TodoResponse{
		ID:          t.ID,
		Title:       t.Title,
		DueDate:     due,
		Position:    t.Position,
		CompletedAt: t.CompletedAt,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
	}
}

// optionalDate tracks whether dueDate was present in JSON and, if so,
// whether it was null (clear) or a string value.
type optionalDate struct {
	set   bool
	value *string
}

func (o *optionalDate) UnmarshalJSON(data []byte) error {
	o.set = true
	if string(data) == "null" {
		o.value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	o.value = &s
	return nil
}

func formatISODate(t time.Time) string {
	return t.Format(isoDateLayout)
}

func parseISODate(s string) (time.Time, bool) {
	t, err := time.Parse(isoDateLayout, s)
	if err != nil {
		return time.Time{}, false
	}
	if t.Format(isoDateLayout) != s {
		return time.Time{}, false
	}
	return t, true
}
