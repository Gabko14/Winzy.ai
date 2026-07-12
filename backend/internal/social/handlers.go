package social

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

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

// decodeOutcome/decodeJSON/requireDecodedBody mirror
// internal/habits/handlers.go's identical three-way JSON body convention —
// see that file's doc comments for the full C# System.Text.Json parity
// rationale (decodeNull vs decodeMalformed, trailing-garbage rejection).
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

// requireDecodedBody decodes r.Body into T, writing the response and
// reporting ok=false for a malformed body ("Invalid JSON in request body")
// or a literal JSON null body ("Request body is required") — the pattern
// every social endpoint with a standalone `if (request is null)` check in
// the C# source uses (SetHabitVisibility, UpdatePreferences,
// CreateWitnessLink, UpdateWitnessLink all have this exact check).
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

// --- friends ---

// SendFriendRequest handles POST /social/friends/request.
func (h *Handlers) SendFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	// decodeNull falls through with a zero-valued req — SendFriendRequest's
	// C# check is combined (`request is null || request.FriendId ==
	// Guid.Empty`), so a null body and an empty/omitted FriendId produce the
	// identical "FriendId is required" message once Service.SendFriendRequest
	// runs below (see habits' decodeOutcome doc comment on decodeNull for
	// this pattern).
	req, outcome := decodeJSON[friendRequestDTO](r)
	if outcome == decodeMalformed {
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return
	}

	friendship, err := h.service.SendFriendRequest(r.Context(), userID, string(req.FriendID))
	if err != nil {
		writeSocialError(w, err)
		return
	}
	w.Header().Set("Location", "/social/friends/request/"+friendship.ID)
	writeJSON(w, http.StatusCreated, toFriendshipResponse(friendship))
}

// AcceptFriendRequest handles PUT /social/friends/request/{id}/accept.
func (h *Handlers) AcceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	friendship, err := h.service.AcceptFriendRequest(r.Context(), userID, id)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toFriendshipResponse(friendship))
}

// DeclineFriendRequest handles PUT /social/friends/request/{id}/decline.
func (h *Handlers) DeclineFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	if err := h.service.DeclineFriendRequest(r.Context(), userID, id); err != nil {
		writeSocialError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RemoveFriend handles DELETE /social/friends/{friendId}.
func (h *Handlers) RemoveFriend(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	friendID := r.PathValue("friendId")

	if err := h.service.RemoveFriend(r.Context(), userID, friendID); err != nil {
		writeSocialError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListFriends handles GET /social/friends?page=&pageSize=.
func (h *Handlers) ListFriends(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	page := intQueryParam(r, "page", defaultPage)
	pageSize := intQueryParam(r, "pageSize", defaultPageSize)

	resp, err := h.service.ListFriends(r.Context(), userID, page, pageSize)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetPendingRequestCount handles GET /social/friends/requests/count.
func (h *Handlers) GetPendingRequestCount(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	count, err := h.service.PendingRequestCount(r.Context(), userID)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pendingCountResponse{Count: count})
}

// ListFriendRequests handles GET /social/friends/requests.
func (h *Handlers) ListFriendRequests(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	resp, err := h.service.ListFriendRequests(r.Context(), userID)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetFriendProfile handles GET /social/friends/{friendId}/profile.
func (h *Handlers) GetFriendProfile(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	friendID := r.PathValue("friendId")

	resp, err := h.service.FriendProfile(r.Context(), userID, friendID)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- visibility & preferences ---

// SetHabitVisibility handles PUT /social/visibility/{habitId}.
func (h *Handlers) SetHabitVisibility(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	habitID := r.PathValue("habitId")

	req, ok := requireDecodedBody[visibilityUpdateDTO](w, r)
	if !ok {
		return
	}

	visibility, err := h.service.SetHabitVisibility(r.Context(), userID, habitID, resolveVisibility(req.Visibility))
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, visibilityResponse{HabitID: habitID, Visibility: visibility.String()})
}

// GetPreferences handles GET /social/preferences.
func (h *Handlers) GetPreferences(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	visibility, err := h.service.Preferences(r.Context(), userID)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preferencesResponse{DefaultHabitVisibility: visibility.String()})
}

// UpdatePreferences handles PUT /social/preferences.
func (h *Handlers) UpdatePreferences(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, ok := requireDecodedBody[preferencesUpdateDTO](w, r)
	if !ok {
		return
	}

	visibility, err := h.service.UpdatePreferences(r.Context(), userID, resolveVisibility(req.DefaultHabitVisibility))
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preferencesResponse{DefaultHabitVisibility: visibility.String()})
}

// GetBatchVisibility handles GET /social/visibility.
func (h *Handlers) GetBatchVisibility(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	resp, err := h.service.BatchVisibility(r.Context(), userID)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- witness links ---

// CreateWitnessLink handles POST /social/witness-links.
func (h *Handlers) CreateWitnessLink(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, ok := requireDecodedBody[witnessLinkCreateDTO](w, r)
	if !ok {
		return
	}

	link, habitIDs, err := h.service.CreateWitnessLink(r.Context(), userID, req.Label, req.HabitIDs)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	w.Header().Set("Location", "/social/witness-links/"+link.ID)
	writeJSON(w, http.StatusCreated, toWitnessLinkResponse(link, habitIDs))
}

// ListWitnessLinks handles GET /social/witness-links.
func (h *Handlers) ListWitnessLinks(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	links, habitMap, err := h.service.ListWitnessLinks(r.Context(), userID)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	items := make([]witnessLinkResponse, len(links))
	for i, l := range links {
		items[i] = toWitnessLinkResponse(l, habitMap[l.ID])
	}
	writeJSON(w, http.StatusOK, listWitnessLinksResponse{Items: items})
}

// UpdateWitnessLink handles PUT /social/witness-links/{id}.
func (h *Handlers) UpdateWitnessLink(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	req, ok := requireDecodedBody[witnessLinkUpdateDTO](w, r)
	if !ok {
		return
	}

	link, habitIDs, err := h.service.UpdateWitnessLink(r.Context(), userID, id, req.Label, req.HabitIDs, req.HabitIDs != nil)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toWitnessLinkResponse(link, habitIDs))
}

// RevokeWitnessLink handles DELETE /social/witness-links/{id}.
func (h *Handlers) RevokeWitnessLink(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	if err := h.service.RevokeWitnessLink(r.Context(), userID, id); err != nil {
		writeSocialError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RotateToken handles POST /social/witness-links/{id}/rotate.
func (h *Handlers) RotateToken(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")

	link, habitIDs, err := h.service.RotateToken(r.Context(), userID, id)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toWitnessLinkResponse(link, habitIDs))
}

// ViewWitnessLink handles the PUBLIC GET /social/witness/{token} — no
// authentication, reachable by anyone holding the token. Sets the
// noindex/no-cache headers unconditionally, matching ViewWitnessLink in
// WitnessLinkEndpoints.cs, BEFORE the constant-time-404 check runs (the
// headers themselves carry no information about the token's validity).
func (h *Handlers) ViewWitnessLink(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")

	w.Header().Set("X-Robots-Tag", "noindex")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")

	resp, err := h.service.ViewWitnessLink(r.Context(), token)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusNotFound, "This witness link is not available")
			return
		}
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- helpers ---

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

func toFriendshipResponse(f Friendship) friendshipResponse {
	return friendshipResponse{
		ID: f.ID, UserID: f.UserID, FriendID: f.FriendID,
		Status: f.Status.String(), CreatedAt: f.CreatedAt,
	}
}

func toWitnessLinkResponse(w WitnessLink, habitIDs []string) witnessLinkResponse {
	if habitIDs == nil {
		habitIDs = []string{}
	}
	return witnessLinkResponse{ID: w.ID, Token: w.Token, Label: w.Label, HabitIDs: habitIDs, CreatedAt: w.CreatedAt}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// writeSocialError maps a Service error to its HTTP response: a *fieldError
// is 400 {"error": "..."}, ErrNotFound is a bare 404, a conflict is 409
// {"error": "..."} with the message read from the concrete *conflictError
// (see store.go's doc comment on why a bare ErrConflict can never reach the
// writeError call below with a leaked internal message), anything else is a
// generic 500 — matching every social endpoint's error contract in
// FriendEndpoints.cs/VisibilityEndpoints.cs/WitnessLinkEndpoints.cs (a plain
// {"error": "..."} shape throughout, no {"errors": {field: [...]}} dict).
func writeSocialError(w http.ResponseWriter, err error) {
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
		// Defensive only: every conflict-producing call site in this
		// package returns a *conflictError (caught by the branch above), so
		// this is unreachable in practice — but if some future path ever
		// returns the bare sentinel, this is the deliberate non-leaking
		// fallback rather than echoing ErrConflict's own internal text.
		writeError(w, http.StatusConflict, "Conflict.")
	default:
		writeError(w, http.StatusInternalServerError, "Internal server error.")
	}
}
