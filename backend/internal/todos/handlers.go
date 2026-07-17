package todos

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/Gabko14/winzy/backend/internal/httpserver"
)

// Handlers wires HTTP handlers to a Service.
type Handlers struct {
	service *Service
}

// NewHandlers returns Handlers backed by service.
func NewHandlers(service *Service) *Handlers {
	return &Handlers{service: service}
}

type decodeOutcome int

const (
	decodeOK decodeOutcome = iota
	decodeNull
	decodeMalformed
)

func decodeJSON[T any](r *http.Request) (T, decodeOutcome) {
	var zero T
	if r.Body == nil {
		return zero, decodeMalformed
	}
	dec := json.NewDecoder(r.Body)
	var ptr *T
	if err := dec.Decode(&ptr); err != nil {
		return zero, decodeMalformed
	}
	if _, err := dec.Token(); err != io.EOF {
		return zero, decodeMalformed
	}
	if ptr == nil {
		return zero, decodeNull
	}
	return *ptr, decodeOK
}

func requireDecodedBody[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	req, outcome := decodeJSON[T](r)
	switch outcome {
	case decodeMalformed:
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return req, false
	case decodeNull:
		writeError(w, http.StatusBadRequest, "Request body is required")
		return req, false
	default:
		return req, true
	}
}

func (h *Handlers) CreateTodo(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, ok := requireDecodedBody[CreateTodoRequest](w, r)
	if !ok {
		return
	}

	todo, err := h.service.CreateTodo(r.Context(), userID, req)
	if err != nil {
		writeTodosError(w, err)
		return
	}

	w.Header().Set("Location", "/todos/"+todo.ID)
	writeJSON(w, http.StatusCreated, toTodoResponse(todo))
}

func (h *Handlers) ListTodos(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	status := r.URL.Query().Get("status")

	list, err := h.service.ListTodos(r.Context(), userID, status)
	if err != nil {
		writeTodosError(w, err)
		return
	}

	responses := make([]TodoResponse, len(list))
	for i, todo := range list {
		responses[i] = toTodoResponse(todo)
	}
	writeJSON(w, http.StatusOK, responses)
}

func (h *Handlers) UpdateTodo(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	req, ok := requireDecodedBody[UpdateTodoRequest](w, r)
	if !ok {
		return
	}

	todo, err := h.service.UpdateTodo(r.Context(), userID, id, req)
	if err != nil {
		writeTodosError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toTodoResponse(todo))
}

func (h *Handlers) CompleteTodo(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	todo, err := h.service.CompleteTodo(r.Context(), userID, id)
	if err != nil {
		writeTodosError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toTodoResponse(todo))
}

func (h *Handlers) UncompleteTodo(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	todo, err := h.service.UncompleteTodo(r.Context(), userID, id)
	if err != nil {
		writeTodosError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toTodoResponse(todo))
}

func (h *Handlers) DeleteTodo(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	if err := h.service.DeleteTodo(r.Context(), userID, id); err != nil {
		writeTodosError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) OrderTodos(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, ok := requireDecodedBody[OrderTodosRequest](w, r)
	if !ok {
		return
	}

	if err := h.service.OrderTodos(r.Context(), userID, req.TodoIDs); err != nil {
		writeTodosError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeTodosError(w http.ResponseWriter, err error) {
	var ferr *fieldError
	switch {
	case errors.As(err, &ferr):
		writeError(w, http.StatusBadRequest, ferr.Error())
	case errors.Is(err, ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
	case errors.Is(err, ErrStaleOrder):
		writeError(w, http.StatusConflict, "Your to-do list changed. Refresh and try again.")
	default:
		writeError(w, http.StatusInternalServerError, "Internal server error.")
	}
}
