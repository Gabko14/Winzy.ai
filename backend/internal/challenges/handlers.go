package challenges

import (
	"encoding/json"
	"errors"
	"io"
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

type decodeOutcome int

const (
	decodeOK decodeOutcome = iota
	decodeNull
	decodeMalformed
)

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
	if _, err := dec.Token(); err != io.EOF {
		return zero, decodeMalformed
	}
	if ptr == nil {
		return zero, decodeNull
	}
	return *ptr, decodeOK
}

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

// CreateChallenge handles POST /challenges.
func (h *Handlers) CreateChallenge(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	dto, ok := requireDecodedBody[createChallengeDTO](w, r)
	if !ok {
		return
	}

	mt := MilestoneType(dto.MilestoneType)
	if mt == "" {
		mt = MilestoneConsistencyTarget
	}

	req := CreateChallengeRequest{
		HabitID: string(dto.HabitID), RecipientID: string(dto.RecipientID),
		MilestoneType: mt, TargetValue: dto.TargetValue, PeriodDays: dto.PeriodDays,
		RewardDescription: dto.RewardDescription,
		CustomStartDate:   dto.CustomStartDate, CustomEndDate: dto.CustomEndDate,
	}

	challenge, err := h.service.Create(r.Context(), userID, req)
	if err != nil {
		writeChallengeError(w, err)
		return
	}
	w.Header().Set("Location", "/challenges/"+challenge.ID)
	writeJSON(w, http.StatusCreated, toChallengeResponse(challenge, h.service.now()))
}

// ListChallenges handles GET /challenges.
func (h *Handlers) ListChallenges(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	page := intQueryParam(r, "page", 1)
	pageSize := intQueryParam(r, "pageSize", 20)
	status := r.URL.Query().Get("status")

	var since *time.Time
	if raw := r.URL.Query().Get("since"); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			parsed, err = time.Parse(time.RFC3339Nano, raw)
		}
		if err == nil {
			since = &parsed
		}
	}

	resp, err := h.service.List(r.Context(), userID, page, pageSize, status, since)
	if err != nil {
		writeChallengeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetChallenge handles GET /challenges/{id}.
func (h *Handlers) GetChallenge(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	resp, err := h.service.Get(r.Context(), userID, id)
	if err != nil {
		writeChallengeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ClaimChallenge handles PUT /challenges/{id}/claim.
func (h *Handlers) ClaimChallenge(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	challenge, err := h.service.Claim(r.Context(), userID, id)
	if err != nil {
		writeChallengeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toChallengeResponse(challenge, h.service.now()))
}

// CancelChallenge handles DELETE /challenges/{id}.
func (h *Handlers) CancelChallenge(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	if err := h.service.Cancel(r.Context(), userID, id); err != nil {
		writeChallengeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func intQueryParam(r *http.Request, name string, fallback int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeChallengeError(w http.ResponseWriter, err error) {
	var ferr *fieldError
	var cerr *conflictError
	switch {
	case errors.As(err, &ferr):
		writeError(w, http.StatusBadRequest, ferr.Error())
	case errors.Is(err, ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
	case errors.As(err, &cerr):
		writeError(w, http.StatusConflict, cerr.Error())
	case errors.Is(err, ErrConflict):
		writeError(w, http.StatusConflict, "An active challenge already exists for this habit and recipient")
	case errors.Is(err, ErrUnavailable):
		w.WriteHeader(http.StatusServiceUnavailable)
	default:
		writeError(w, http.StatusInternalServerError, "Internal server error.")
	}
}
