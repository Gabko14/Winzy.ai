package habits

import (
	"errors"
	"net/http"

	"github.com/Gabko14/winzy/backend/internal/httpserver"
)

// CreatePromise handles POST /habits/{id}/promise.
func (h *Handlers) CreatePromise(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")

	req, ok := requireDecodedBody[CreatePromiseRequest](w, r)
	if !ok {
		return
	}

	promise, err := h.service.CreatePromise(r.Context(), userID, habitID, req, r.Header.Get("X-Timezone"))
	if err != nil {
		writePromiseError(w, err)
		return
	}

	w.Header().Set("Location", "/habits/"+habitID+"/promise")
	writeJSON(w, http.StatusCreated, toPromiseResponse(promise, nil))
}

// GetPromise handles GET /habits/{id}/promise?history=true|false.
func (h *Handlers) GetPromise(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")
	includeHistory := r.URL.Query().Get("history") == "true"

	resp, err := h.service.GetPromise(r.Context(), userID, habitID, r.Header.Get("X-Timezone"), includeHistory)
	if err != nil {
		writePromiseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// CancelPromise handles DELETE /habits/{id}/promise.
func (h *Handlers) CancelPromise(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")

	if err := h.service.CancelPromise(r.Context(), userID, habitID); err != nil {
		writePromiseError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ToggleVisibility handles PATCH /habits/{id}/promise/visibility.
func (h *Handlers) ToggleVisibility(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")

	req, ok := requireDecodedBody[UpdatePromiseVisibilityRequest](w, r)
	if !ok {
		return
	}

	promise, err := h.service.ToggleVisibility(r.Context(), userID, habitID, req)
	if err != nil {
		writePromiseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"isPublicOnFlame": promise.IsPublicOnFlame})
}

// writePromiseError maps a promise Service error to its HTTP response,
// mirroring writeHabitsError but with the promise-specific 409 message —
// kept as a separate function rather than folded into writeHabitsError so
// completions' "Habit already completed for this date" 409 and promises'
// "An active promise already exists for this habit" 409 can never be
// cross-wired by an errors.Is check matching the wrong sentinel.
func writePromiseError(w http.ResponseWriter, err error) {
	var ferr *fieldError
	switch {
	case errors.As(err, &ferr):
		writeError(w, http.StatusBadRequest, ferr.Error())
	case errors.Is(err, ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
	case errors.Is(err, ErrPromiseConflict):
		writeError(w, http.StatusConflict, "An active promise already exists for this habit")
	default:
		writeError(w, http.StatusInternalServerError, "Internal server error.")
	}
}
