package habits

import "net/http"

// RegisterRoutes mounts every /habits/* HTTP endpoint on mux. All of them
// require auth (there are no public routes in this bead — public flame
// surfaces land with winzy.ai-rdc7.3.3), and none are internal-only
// endpoints exposed through the Gateway pattern the old system used (the
// old /habits/user/{userId} and /habits/internal/... endpoints become
// direct in-process calls once other modules need them, per the epic).
//
// The literal "GET /habits/completions" route is registered so it takes
// precedence over the wildcard "GET /habits/{id}" for that exact path —
// net/http's ServeMux (Go 1.22+) resolves this correctly regardless of
// registration order (a more specific literal pattern always wins over an
// overlapping wildcard), but it is listed first here for readability.
func RegisterRoutes(mux *http.ServeMux, h *Handlers) {
	mux.HandleFunc("POST /habits", h.CreateHabit)
	mux.HandleFunc("GET /habits", h.ListHabits)
	mux.HandleFunc("GET /habits/completions", h.CompletionsByDate)
	mux.HandleFunc("GET /habits/{id}", h.GetHabit)
	mux.HandleFunc("PUT /habits/{id}", h.UpdateHabit)
	mux.HandleFunc("DELETE /habits/{id}", h.ArchiveHabit)
	mux.HandleFunc("POST /habits/{id}/complete", h.CompleteHabit)
	mux.HandleFunc("GET /habits/{id}/stats", h.Stats)
	mux.HandleFunc("DELETE /habits/{id}/completions/{date}", h.DeleteCompletion)
	mux.HandleFunc("PUT /habits/{id}/completions/{date}", h.UpdateCompletion)
}
