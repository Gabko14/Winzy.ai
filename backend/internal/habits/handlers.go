package habits

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

// decodeOutcome is decodeJSON's three-way result.
type decodeOutcome int

const (
	// decodeOK means a JSON value was decoded — possibly a `{}` with every
	// field at its zero value, which is a perfectly valid, present object.
	decodeOK decodeOutcome = iota
	// decodeNull means the body was the literal JSON value `null`.
	// System.Text.Json's JsonSerializer.Deserialize<T> parses that
	// successfully into a null reference (T is a C# record — a reference
	// type) rather than throwing; RequestBodyHelper.TryReadBodyAsync
	// reports no error either. What a null body maps to varies by endpoint
	// in the C# source: some (UpdateHabit, UpdateCompletion, CreatePromise,
	// ToggleVisibility) have a standalone `if (request is null) return
	// BadRequest("Request body is required")` check; others (CreateHabit,
	// CompleteHabit) fold the null check into a combined check with another
	// required field (`request is null || string.IsNullOrWhiteSpace(...)`),
	// which produces a field-specific message instead — see each handler
	// below for how it reacts to decodeNull.
	decodeNull
	// decodeMalformed means the body was missing, empty, invalid JSON, or
	// had non-whitespace content after a complete JSON value — matching
	// System.Text.Json's JsonSerializer, which requires the ENTIRE body to
	// be consumed and throws JsonException on trailing content;
	// TryReadBodyAsync maps any such exception to "Invalid JSON in request
	// body" (see HabitEndpointTests.cs's *_EmptyBody_Returns400 and
	// *_MalformedJson_Returns400 cases, which assert that identical
	// message).
	decodeMalformed
)

// decodeJSON decodes r.Body into T and reports which of the three outcomes
// above occurred.
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
	// Reject any trailing non-whitespace content after the value — Go's
	// json.Decoder, unlike System.Text.Json's JsonSerializer, otherwise
	// happily decodes one leading value from a stream and silently ignores
	// whatever comes after it.
	if _, err := dec.Token(); err != io.EOF {
		return zero, decodeMalformed
	}
	if ptr == nil {
		return zero, decodeNull
	}
	return *ptr, decodeOK
}

// requireDecodedBody decodes r.Body into T, writing the response and
// reporting ok=false for a malformed body ("Invalid JSON in request body")
// or a literal JSON null body ("Request body is required") — the pattern
// UpdateHabit, UpdateCompletion, CreatePromise, and ToggleVisibility all
// share (their C# counterparts each have a standalone `if (request is null)
// return BadRequest("Request body is required")` check with no other field
// involved). CreateHabit and CompleteHabit do NOT use this: their own
// field-specific validation already reproduces the C#'s combined-check
// message for a null body without any special case (see decodeOutcome's
// doc comment on decodeNull).
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

// CreateHabit handles POST /habits.
func (h *Handlers) CreateHabit(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	// decodeNull deliberately falls through with a zero-valued req rather
	// than a distinct 400 here — CreateHabit in HabitEndpoints.cs folds its
	// null check into `request is null || string.IsNullOrWhiteSpace(request.Name)`,
	// so a null body and an empty Name produce the identical "Name is
	// required" message once CreateHabit's own validation runs below (see
	// decodeOutcome's doc comment on decodeNull for the other endpoints that
	// DO need a standalone check).
	req, outcome := decodeJSON[CreateHabitRequest](r)
	if outcome == decodeMalformed {
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

// OrderHabits handles PUT /habits/order.
func (h *Handlers) OrderHabits(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, ok := requireDecodedBody[OrderHabitsRequest](w, r)
	if !ok {
		return
	}

	if err := h.service.OrderHabits(r.Context(), userID, req.HabitIDs); err != nil {
		writeHabitsError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

	req, ok := requireDecodedBody[UpdateHabitRequest](w, r)
	if !ok {
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

	// decodeNull falls through with a zero-valued req — CompleteHabit in
	// CompletionEndpoints.cs folds its null check into `request is null ||
	// string.IsNullOrWhiteSpace(request.Timezone)`, so a null body and a
	// blank Timezone produce the identical "Timezone is required" message
	// once resolveTimezone runs inside Service.CompleteHabit (see
	// decodeOutcome's doc comment on decodeNull).
	req, outcome := decodeJSON[CompleteHabitRequest](r)
	if outcome == decodeMalformed {
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return
	}

	completion, consistency, err := h.service.CompleteHabit(r.Context(), userID, habitID, req)
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
		Consistency:    consistency,
	})
}

// Stats handles GET /habits/{id}/stats. The X-Timezone header is required and
// must be a valid IANA id — a missing header is a distinct 400 message from an
// invalid value, matching GetStats in CompletionEndpoints.cs (the header check
// lives here; resolveTimezone in the service handles the invalid-value case).
func (h *Handlers) Stats(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("id")

	timezone := r.Header.Get("X-Timezone")
	if strings.TrimSpace(timezone) == "" {
		writeError(w, http.StatusBadRequest, "X-Timezone header is required")
		return
	}

	stats, err := h.service.HabitStats(r.Context(), userID, habitID, timezone)
	if err != nil {
		writeHabitsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
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

	req, ok := requireDecodedBody[UpdateCompletionRequest](w, r)
	if !ok {
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

// CompletionsInRange handles GET /habits/completions?from=YYYY-MM-DD&to=YYYY-MM-DD.
func (h *Handlers) CompletionsInRange(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	from := r.URL.Query().Get("from")
	if strings.TrimSpace(from) == "" {
		writeError(w, http.StatusBadRequest, "from query parameter is required (YYYY-MM-DD)")
		return
	}
	to := r.URL.Query().Get("to")
	if strings.TrimSpace(to) == "" {
		writeError(w, http.StatusBadRequest, "to query parameter is required (YYYY-MM-DD)")
		return
	}

	resp, err := h.service.CompletionsInRange(r.Context(), userID, from, to)
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
