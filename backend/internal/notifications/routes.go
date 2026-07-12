package notifications

import "net/http"

// RegisterRoutes mounts every /notifications/* HTTP endpoint on mux.
// GET /notifications/vapid-public-key is public (added to main.go's
// publicRoutes allowlist); every other route requires auth. The old
// /notifications/internal/export/{userId} endpoint became the export.Section
// registered in NewService.
func RegisterRoutes(mux *http.ServeMux, h *Handlers) {
	mux.HandleFunc("GET /notifications", h.ListNotifications)
	mux.HandleFunc("PUT /notifications/{id}/read", h.MarkRead)
	mux.HandleFunc("PUT /notifications/read-all", h.MarkAllRead)
	mux.HandleFunc("GET /notifications/unread-count", h.UnreadCount)
	mux.HandleFunc("PUT /notifications/settings", h.UpdateSettings)
	mux.HandleFunc("POST /notifications/devices", h.RegisterDevice)
	mux.HandleFunc("DELETE /notifications/devices", h.UnregisterDevice)
	mux.HandleFunc("GET /notifications/vapid-public-key", h.VAPIDPublicKey)
}
