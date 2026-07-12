package activity

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

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

// GetFeed handles GET /activity/feed?cursor&limit — port of Program.cs.
func (h *Handlers) GetFeed(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		if parsed > 100 {
			parsed = 100
		}
		limit = parsed
	}

	var cursor *time.Time
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			parsed, err = time.Parse(time.RFC3339, raw)
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid cursor format")
			return
		}
		cursor = &parsed
	}

	page, err := h.service.Feed(r.Context(), userID, cursor, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
