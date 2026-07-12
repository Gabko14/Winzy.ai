package activity

import "net/http"

// RegisterRoutes mounts every /activity/* HTTP endpoint on mux. Every
// route requires auth — none are public. The old /activity/internal/export
// endpoint became the export.Section registered in NewService.
// routeMux is satisfied by *http.ServeMux and by the recording registrar
// used in cmd/api's OpenAPI contract test.
type routeMux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

func RegisterRoutes(mux routeMux, h *Handlers) {
	mux.HandleFunc("GET /activity/feed", h.GetFeed)
}
