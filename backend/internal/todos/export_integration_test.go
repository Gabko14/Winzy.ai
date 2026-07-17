//go:build integration

package todos_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/todos"
)

func TestExportSection_HappyPath_IncludesTodos(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, exportReg := newTestServer(t)
	reg := registerUserViaService(t, authService, "todosexport2@example.com", "todosexport2")
	a := bearerFor(t, tokens, reg.User.ID)
	createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Exported", DueDate: strPtr("2026-07-25")})

	services, warnings := exportReg.Export(context.Background(), reg.User.ID)
	if len(warnings) != 0 {
		t.Fatalf("warnings = %v, want none", warnings)
	}

	var found bool
	for _, svc := range services {
		if svc.Service != "todos" {
			continue
		}
		found = true
		raw, err := json.Marshal(svc.Data)
		if err != nil {
			t.Fatalf("marshal export data: %v", err)
		}
		var payload struct {
			Todos []struct {
				Title   string  `json:"title"`
				DueDate *string `json:"dueDate"`
			} `json:"todos"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("unmarshal export data: %v", err)
		}
		if len(payload.Todos) != 1 || payload.Todos[0].Title != "Exported" {
			t.Fatalf("export payload = %+v, want one Exported todo", payload)
		}
		if payload.Todos[0].DueDate == nil || *payload.Todos[0].DueDate != "2026-07-25" {
			t.Errorf("DueDate = %v, want 2026-07-25", payload.Todos[0].DueDate)
		}
	}
	if !found {
		t.Fatalf("services = %+v, want a \"todos\" section", services)
	}
}

func TestExportSection_EdgeCase_NoTodosOmitsSectionSilently(t *testing.T) {
	t.Parallel()
	_, _, _, authService, exportReg := newTestServer(t)
	reg := registerUserViaService(t, authService, "todosexportnone@example.com", "todosexportnone")

	services, warnings := exportReg.Export(context.Background(), reg.User.ID)
	for _, svc := range services {
		if svc.Service == "todos" {
			t.Errorf("services contains a \"todos\" entry for a user with no todos: %+v", svc)
		}
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want none", warnings)
	}
}
