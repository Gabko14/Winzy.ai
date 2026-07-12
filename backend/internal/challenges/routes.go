package challenges

import "net/http"

// RegisterRoutes mounts every /challenges/* HTTP endpoint on mux. Every
// route requires auth — none are public. The old /challenges/internal/export
// endpoint became the export.Section registered in NewService.
// routeMux is satisfied by *http.ServeMux and by the recording registrar
// used in cmd/api's OpenAPI contract test.
type routeMux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

func RegisterRoutes(mux routeMux, h *Handlers) {
	mux.HandleFunc("POST /challenges", h.CreateChallenge)
	mux.HandleFunc("GET /challenges", h.ListChallenges)
	mux.HandleFunc("GET /challenges/{id}", h.GetChallenge)
	mux.HandleFunc("PUT /challenges/{id}/claim", h.ClaimChallenge)
	mux.HandleFunc("DELETE /challenges/{id}", h.CancelChallenge)
}
