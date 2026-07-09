package habits

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/Gabko14/winzy/backend/internal/httpserver"
)

// Handlers wires HTTP handlers to a Service. Register with RegisterRoutes.
type Handlers struct {
	service *Service
}

// NewHandlers returns Handlers backed by service.
func NewHandlers(service *Service) *Handlers {
	return &Handlers{service: service}
}

// decodeJSON decodes r.Body into T, returning ok=false for a missing,
// empty, or malformed body. Unlike internal/auth's decodeJSON (which treats
// an empty body as valid, since every auth DTO's fields are separately
// optional), every habits request DTO requires an actual JSON object —
// matching RequestBodyHelper.TryReadBodyAsync, which reports both a
// missing and a malformed body as the same "Invalid JSON in request body"
// 400 (see HabitEndpointTests.cs's *_EmptyBody_Returns400 and
// *_MalformedJson_Returns400 cases, which assert the identical message).
func decodeJSON[T any](r *http.Request) (T, bool) {
	var v T
	if r.Body == nil {
		return v, false
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&v); err != nil {
		return v, false
	}
	return v, true
}

// CreateHabit handles POST /habits.
func (h *Handlers) CreateHabit(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, ok := decodeJSON[CreateHabitRequest](r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return
	}

	habit, err := h.service.CreateHabit(r.Context(), userID, req)
	if err != nil {
		writeHabitsError(w, err)
		return
	}

	w.Header().Set("Location", "/habits/"+habit.ID)
	writeJSON(w, http.StatusCreated, toHabitResponse(habit))
}

// ListHabits handles GET /habits.
func (h *Handlers) ListHabits(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	list, err := h.service.ListHabits(r.Context(), userID)
	if err != nil {
		writeHabitsError(w, err)
		return
	}

	responses := make([]HabitResponse, len(list))
	for i, habit := range list {
		responses[i] = toHabitResponse(habit)
	}
	writeJSON(w, http.StatusOK, responses)
}

// GetHabit handles GET /habits/{id}.
func (h *Handlers) GetHabit(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	habit, err := h.service.GetHabit(r.Context(), userID, id)
	if err != nil {
		writeHabitsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toHabitResponse(habit))
}

// UpdateHabit handles PUT /habits/{id}.
func (h *Handlers) UpdateHabit(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	req, ok := decodeJSON[UpdateHabitRequest](r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return
	}

	habit, err := h.service.UpdateHabit(r.Context(), userID, id, req)
	if err != nil {
		writeHabitsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toHabitResponse(habit))
}

// ArchiveHabit handles DELETE /habits/{id} — a soft archive, not a hard
// delete (see Service.ArchiveHabit's doc comment).
func (h *Handlers) ArchiveHabit(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	if err := h.service.ArchiveHabit(r.Context(), userID, id); err != nil {
		writeHabitsError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// CompleteHabit handles POST /habits/{id}/complete.
func (h *Handlers) CompleteHabit(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")

	req, ok := decodeJSON[CompleteHabitRequest](r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return
	}

	completion, err := h.service.CompleteHabit(r.Context(), userID, habitID, req)
	if err != nil {
		writeHabitsError(w, err)
		return
	}

	localDate := formatISODate(completion.LocalDate)
	w.Header().Set("Location", fmt.Sprintf("/habits/%s/completions/%s", habitID, localDate))
	writeJSON(w, http.StatusCreated, CompletionResponse{
		ID:             completion.ID,
		HabitID:        habitID,
		LocalDate:      localDate,
		CompletedAt:    completion.CompletedAt,
		CompletionKind: completion.CompletionKind.String(),
		Consistency:    0, // TODO(winzy.ai-rdc7.3.2): real weighted consistency
	})
}

// DeleteCompletion handles DELETE /habits/{id}/completions/{date}.
func (h *Handlers) DeleteCompletion(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")
	date := r.PathValue("date")

	found, err := h.service.DeleteCompletion(r.Context(), userID, habitID, date)
	if err != nil {
		writeHabitsError(w, err)
		return
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UpdateCompletion handles PUT /habits/{id}/completions/{date}.
func (h *Handlers) UpdateCompletion(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")
	date := r.PathValue("date")

	req, ok := decodeJSON[UpdateCompletionRequest](r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return
	}

	completion, found, err := h.service.UpdateCompletion(r.Context(), userID, habitID, date, req.CompletionKind)
	if err != nil {
		writeHabitsError(w, err)
		return
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, UpdateCompletionResponse{
		ID:             completion.ID,
		HabitID:        habitID,
		LocalDate:      formatISODate(completion.LocalDate),
		CompletedAt:    completion.CompletedAt,
		CompletionKind: completion.CompletionKind.String(),
	})
}

// CompletionsByDate handles GET /habits/completions?date=YYYY-MM-DD.
func (h *Handlers) CompletionsByDate(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	date := r.URL.Query().Get("date")
	if strings.TrimSpace(date) == "" {
		writeError(w, http.StatusBadRequest, "date query parameter is required (YYYY-MM-DD)")
		return
	}

	resp, err := h.service.CompletionsByDate(r.Context(), userID, date)
	if err != nil {
		writeHabitsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- response helpers ---

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// writeHabitsError maps a Service error to the HTTP status/body contract
// ported directly from HabitEndpoints.cs / CompletionEndpoints.cs: every
// validation failure is 400 {"error": "..."} (there is no {"errors":
// {field: [...]}} dict in this module — see validation.go's fieldError doc
// comment for why habits and auth genuinely differ here), not-found is a
// bare 404, and the one conflict case (duplicate completion) is 409
// {"error": "Habit already completed for this date"}.
func writeHabitsError(w http.ResponseWriter, err error) {
	var ferr *fieldError
	switch {
	case errors.As(err, &ferr):
		writeError(w, http.StatusBadRequest, ferr.Error())
	case errors.Is(err, ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
	case errors.Is(err, ErrConflict):
		writeError(w, http.StatusConflict, "Habit already completed for this date")
	default:
		writeError(w, http.StatusInternalServerError, "Internal server error.")
	}
}
