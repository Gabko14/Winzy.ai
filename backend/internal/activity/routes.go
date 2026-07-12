package activity

import "net/http"

// RegisterRoutes mounts every /activity/* HTTP endpoint on mux. Every
// route requires auth — none are public. The old /activity/internal/export
// endpoint became the export.Section registered in NewService.
func RegisterRoutes(mux *http.ServeMux, h *Handlers) {
	mux.HandleFunc("GET /activity/feed", h.GetFeed)
}
