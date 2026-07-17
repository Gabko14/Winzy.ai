package todos

import "net/http"

type routeMux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

// RegisterRoutes mounts every /todos/* HTTP endpoint on mux. All routes
// require auth — none are public.
func RegisterRoutes(mux routeMux, h *Handlers) {
	mux.HandleFunc("POST /todos", h.CreateTodo)
	mux.HandleFunc("GET /todos", h.ListTodos)
	mux.HandleFunc("PUT /todos/order", h.OrderTodos)
	mux.HandleFunc("PUT /todos/{id}", h.UpdateTodo)
	mux.HandleFunc("POST /todos/{id}/complete", h.CompleteTodo)
	mux.HandleFunc("DELETE /todos/{id}/complete", h.UncompleteTodo)
	mux.HandleFunc("DELETE /todos/{id}", h.DeleteTodo)
}
