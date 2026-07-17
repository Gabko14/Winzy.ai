//go:build integration

package todos_test

import (
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/Gabko14/winzy/backend/internal/todos"
)

func TestCreateTodo_HappyPath_ReturnsCreated(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000001"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos", headers: a,
		body: todos.CreateTodoRequest{Title: "Buy milk", DueDate: strPtr("2026-07-20")},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	if resp.Header.Get("Location") == "" {
		t.Error("Location header missing")
	}
	body := decodeBody[todos.TodoResponse](t, resp)
	if body.Title != "Buy milk" {
		t.Errorf("Title = %q, want Buy milk", body.Title)
	}
	if body.DueDate == nil || *body.DueDate != "2026-07-20" {
		t.Errorf("DueDate = %v, want 2026-07-20", body.DueDate)
	}
	if body.Position != 0 {
		t.Errorf("Position = %d, want 0 for first todo", body.Position)
	}
	if body.CompletedAt != nil {
		t.Error("CompletedAt should be nil")
	}
}

func TestCreateTodo_HappyPath_AppendsPosition(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000002"))

	first := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "One"})
	second := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Two"})
	if first.Position != 0 || second.Position != 1 {
		t.Errorf("positions = %d, %d; want 0, 1", first.Position, second.Position)
	}
}

func TestListTodos_HappyPath_FiltersAndOrders(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000003"))

	a1 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "A"})
	a2 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "B"})
	_ = createTodo(t, srv, a, todos.CreateTodoRequest{Title: "C"})

	completeResp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos/" + a1.ID + "/complete", headers: a,
	})
	if completeResp.StatusCode != http.StatusOK {
		t.Fatalf("complete status = %d, want 200", completeResp.StatusCode)
	}

	openResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos", headers: a})
	openList := decodeBody[[]todos.TodoResponse](t, openResp)
	if len(openList) != 2 {
		t.Fatalf("open count = %d, want 2", len(openList))
	}
	if openList[0].ID != a2.ID {
		t.Errorf("open[0] = %s, want %s (position order)", openList[0].ID, a2.ID)
	}

	completedResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos?status=completed", headers: a})
	completedList := decodeBody[[]todos.TodoResponse](t, completedResp)
	if len(completedList) != 1 || completedList[0].ID != a1.ID {
		t.Fatalf("completed = %+v, want only %s", completedList, a1.ID)
	}

	allResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos?status=all", headers: a})
	allList := decodeBody[[]todos.TodoResponse](t, allResp)
	if len(allList) != 3 {
		t.Fatalf("all count = %d, want 3", len(allList))
	}
}

func TestUpdateTodo_HappyPath_UpdatesTitleAndDueDate(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000004"))
	todo := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Old"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/" + todo.ID, headers: a,
		body: map[string]any{"title": "New", "dueDate": "2026-08-01"},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[todos.TodoResponse](t, resp)
	if body.Title != "New" {
		t.Errorf("Title = %q, want New", body.Title)
	}
	if body.DueDate == nil || *body.DueDate != "2026-08-01" {
		t.Errorf("DueDate = %v, want 2026-08-01", body.DueDate)
	}
}

func TestCompleteUncomplete_HappyPath_RoundTrip(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000005"))
	todo := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Task"})

	completeResp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos/" + todo.ID + "/complete", headers: a,
	})
	completed := decodeBody[todos.TodoResponse](t, completeResp)
	if completed.CompletedAt == nil {
		t.Fatal("CompletedAt should be set")
	}

	uncompleteResp := doRequest(t, srv, testRequest{
		method: http.MethodDelete, path: "/todos/" + todo.ID + "/complete", headers: a,
	})
	reopened := decodeBody[todos.TodoResponse](t, uncompleteResp)
	if reopened.CompletedAt != nil {
		t.Error("CompletedAt should be nil after uncomplete")
	}
}

func TestOrderTodos_HappyPath_RoundTrip(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000006"))
	t1 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "One"})
	t2 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Two"})
	t3 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Three"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/order", headers: a,
		body: todos.OrderTodosRequest{TodoIDs: []string{t3.ID, t1.ID, t2.ID}},
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order status = %d, want 204", resp.StatusCode)
	}

	listResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos", headers: a})
	list := decodeBody[[]todos.TodoResponse](t, listResp)
	if len(list) != 3 || list[0].ID != t3.ID || list[1].ID != t1.ID || list[2].ID != t2.ID {
		t.Fatalf("order after reorder = %+v", list)
	}
}

func TestDeleteTodo_HappyPath_RemovesRow(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000007"))
	todo := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Gone"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodDelete, path: "/todos/" + todo.ID, headers: a,
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	listResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos?status=all", headers: a})
	list := decodeBody[[]todos.TodoResponse](t, listResp)
	if len(list) != 0 {
		t.Errorf("list after delete = %+v, want empty", list)
	}
}

func TestCreateTodo_EdgeCase_256RuneTitleIncludingEmoji(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000008"))

	title := strings.Repeat("a", 255) + "🔥"
	if utf8.RuneCountInString(title) != 256 {
		t.Fatalf("fixture rune count = %d, want 256", utf8.RuneCountInString(title))
	}
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos", headers: a,
		body: todos.CreateTodoRequest{Title: title},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201 for 256-rune title", resp.StatusCode)
	}
}

func TestUpdateTodo_EdgeCase_DueDateSetAndClear(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000009"))
	todo := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Dated", DueDate: strPtr("2026-07-21")})

	clearResp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/" + todo.ID, headers: a,
		rawBody: `{"dueDate":null}`,
	})
	cleared := decodeBody[todos.TodoResponse](t, clearResp)
	if cleared.DueDate != nil {
		t.Errorf("DueDate = %v, want nil after explicit null", cleared.DueDate)
	}

	omitResp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/" + todo.ID, headers: a,
		body: map[string]any{"title": "Still dated", "dueDate": "2026-07-22"},
	})
	set := decodeBody[todos.TodoResponse](t, omitResp)
	if set.DueDate == nil || *set.DueDate != "2026-07-22" {
		t.Errorf("DueDate = %v, want 2026-07-22", set.DueDate)
	}

	titleOnly := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/" + todo.ID, headers: a,
		body: map[string]any{"title": "Title only"},
	})
	kept := decodeBody[todos.TodoResponse](t, titleOnly)
	if kept.DueDate == nil || *kept.DueDate != "2026-07-22" {
		t.Errorf("DueDate = %v, want kept 2026-07-22 when omitted", kept.DueDate)
	}
}

func TestUncomplete_EdgeCase_AppendsAtEnd(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000a"))
	first := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "First"})
	second := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Second"})
	third := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Third"})

	doRequest(t, srv, testRequest{method: http.MethodPost, path: "/todos/" + first.ID + "/complete", headers: a})
	_ = second
	_ = third

	uncomplete := doRequest(t, srv, testRequest{
		method: http.MethodDelete, path: "/todos/" + first.ID + "/complete", headers: a,
	})
	reopened := decodeBody[todos.TodoResponse](t, uncomplete)

	listResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos", headers: a})
	list := decodeBody[[]todos.TodoResponse](t, listResp)
	if len(list) != 3 {
		t.Fatalf("open count = %d, want 3", len(list))
	}
	if list[2].ID != first.ID {
		t.Errorf("last open = %s, want reopened %s at end", list[2].ID, first.ID)
	}
	if reopened.Position != list[2].Position {
		t.Errorf("reopened position = %d, list end = %d", reopened.Position, list[2].Position)
	}
}

func TestComplete_EdgeCase_AlreadyCompletedIsNoOp(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000b"))
	todo := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Done"})

	first := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/todos/" + todo.ID + "/complete", headers: a})
	firstBody := decodeBody[todos.TodoResponse](t, first)
	second := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/todos/" + todo.ID + "/complete", headers: a})
	if second.StatusCode != http.StatusOK {
		t.Fatalf("second complete status = %d, want 200", second.StatusCode)
	}
	secondBody := decodeBody[todos.TodoResponse](t, second)
	if firstBody.CompletedAt == nil || secondBody.CompletedAt == nil {
		t.Fatal("CompletedAt should stay set")
	}
	if !firstBody.CompletedAt.Equal(*secondBody.CompletedAt) {
		t.Errorf("CompletedAt changed on no-op: %v vs %v", firstBody.CompletedAt, secondBody.CompletedAt)
	}
}

func TestUncomplete_EdgeCase_AlreadyOpenIsNoOp(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000c"))
	todo := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Open"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodDelete, path: "/todos/" + todo.ID + "/complete", headers: a,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[todos.TodoResponse](t, resp)
	if body.CompletedAt != nil {
		t.Error("CompletedAt should remain nil")
	}
	if body.Position != todo.Position {
		t.Errorf("Position = %d, want unchanged %d", body.Position, todo.Position)
	}
}

func TestOrderTodos_EdgeCase_ExcludesCompleted(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000d"))
	open1 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Open1"})
	open2 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Open2"})
	done := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Done"})
	doRequest(t, srv, testRequest{method: http.MethodPost, path: "/todos/" + done.ID + "/complete", headers: a})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/order", headers: a,
		body: todos.OrderTodosRequest{TodoIDs: []string{open2.ID, open1.ID, done.ID}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when including completed id", resp.StatusCode)
	}
}

func TestCreateTodo_ErrorCase_EmptyTitle(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000e"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos", headers: a,
		body: todos.CreateTodoRequest{Title: "   "},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	errBody := decodeBody[map[string]string](t, resp)
	if errBody["error"] == "" {
		t.Error(`expected non-empty "error"`)
	}
}

func TestCreateTodo_ErrorCase_OverLengthTitle(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "00000000000f"))

	title := strings.Repeat("x", 257)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos", headers: a,
		body: todos.CreateTodoRequest{Title: title},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCreateTodo_ErrorCase_BadDate(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000010"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos", headers: a,
		body: todos.CreateTodoRequest{Title: "Bad", DueDate: strPtr("2026-02-30")},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUpdateTodo_ErrorCase_ForeignTodoReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	owner := bearerFor(t, tokens, newUserID(t, "000000000011"))
	other := bearerFor(t, tokens, newUserID(t, "000000000012"))
	todo := createTodo(t, srv, owner, todos.CreateTodoRequest{Title: "Secret"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/" + todo.ID, headers: other,
		body: map[string]any{"title": "Hijack"},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestOrderTodos_ErrorCase_DuplicatesAndUnknownAre400(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000013"))
	t1 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "One"})
	t2 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Two"})

	dup := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/order", headers: a,
		body: todos.OrderTodosRequest{TodoIDs: []string{t1.ID, t1.ID}},
	})
	if dup.StatusCode != http.StatusBadRequest {
		t.Fatalf("duplicates status = %d, want 400", dup.StatusCode)
	}

	unknown := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/order", headers: a,
		body: todos.OrderTodosRequest{TodoIDs: []string{t1.ID, t2.ID, "11111111-1111-4111-8111-111111111111"}},
	})
	if unknown.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown status = %d, want 400", unknown.StatusCode)
	}
}

func TestOrderTodos_ErrorCase_StaleSetReturns409(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000014"))
	t1 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "One"})
	_ = createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Two"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/todos/order", headers: a,
		body: todos.OrderTodosRequest{TodoIDs: []string{t1.ID}},
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", resp.StatusCode)
	}
	errBody := decodeBody[map[string]string](t, resp)
	if errBody["error"] != "Your to-do list changed. Refresh and try again." {
		t.Errorf("error = %q, want stale-order message", errBody["error"])
	}
}

func TestTodos_ErrorCase_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv, _, _, _, _ := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestCreateTodo_ErrorCase_NullBodyReturnsRequestBodyRequired(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000015"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/todos", headers: a, rawBody: "null",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	errBody := decodeBody[map[string]string](t, resp)
	if errBody["error"] != "Request body is required" {
		t.Errorf(`error = %q, want "Request body is required"`, errBody["error"])
	}
}

func TestListTodos_HappyPath_AllOrdersOpenThenCompletedDesc(t *testing.T) {
	t.Parallel()
	srv, tokens, _, _, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "000000000016"))

	open1 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Open1"})
	open2 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Open2"})
	done1 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Done1"})
	done2 := createTodo(t, srv, a, todos.CreateTodoRequest{Title: "Done2"})

	doRequest(t, srv, testRequest{method: http.MethodPost, path: "/todos/" + done1.ID + "/complete", headers: a})
	doRequest(t, srv, testRequest{method: http.MethodPost, path: "/todos/" + done2.ID + "/complete", headers: a})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/todos?status=all", headers: a})
	list := decodeBody[[]todos.TodoResponse](t, resp)
	if len(list) != 4 {
		t.Fatalf("all count = %d, want 4", len(list))
	}
	if list[0].ID != open1.ID || list[1].ID != open2.ID {
		t.Errorf("open block = [%s %s], want [%s %s]", list[0].ID, list[1].ID, open1.ID, open2.ID)
	}
	if list[2].ID != done2.ID || list[3].ID != done1.ID {
		t.Errorf("completed block = [%s %s], want [%s %s] (completed_at DESC)", list[2].ID, list[3].ID, done2.ID, done1.ID)
	}
}
