package notifications

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

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

type updateSettingsDTO struct {
	HabitReminders   *bool            `json:"habitReminders"`
	FriendActivity   *bool            `json:"friendActivity"`
	ChallengeUpdates *bool            `json:"challengeUpdates"`
	ReminderTime     *string          `json:"reminderTime"`
	ReminderTimezone optionalTimezone `json:"reminderTimezone"`
}

type registerDeviceDTO struct {
	Platform string  `json:"platform"`
	Token    string  `json:"token"`
	DeviceID *string `json:"deviceId"`
}

type unregisterDeviceDTO struct {
	DeviceID string `json:"deviceId"`
}

// ListNotifications handles GET /notifications.
func (h *Handlers) ListNotifications(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	page := intQueryParam(r, "page", 1)
	pageSize := intQueryParam(r, "pageSize", 20)

	resp, err := h.service.List(r.Context(), userID, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// MarkRead handles PUT /notifications/{id}/read.
func (h *Handlers) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	id := r.PathValue("id")
	resp, err := h.service.MarkRead(r.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// MarkAllRead handles PUT /notifications/read-all.
func (h *Handlers) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	n, err := h.service.MarkAllRead(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, markedAsReadResponse{MarkedAsRead: n})
}

// UnreadCount handles GET /notifications/unread-count.
func (h *Handlers) UnreadCount(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	n, err := h.service.UnreadCount(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, unreadCountResponse{UnreadCount: n})
}

// GetSettings handles GET /notifications/settings.
func (h *Handlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	resp, err := h.service.GetSettings(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// UpdateSettings handles PUT /notifications/settings.
func (h *Handlers) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	dto, ok := requireDecodedBody[updateSettingsDTO](w, r)
	if !ok {
		return
	}
	resp, err := h.service.UpdateSettings(r.Context(), userID, UpdateSettingsRequest{
		HabitReminders:   dto.HabitReminders,
		FriendActivity:   dto.FriendActivity,
		ChallengeUpdates: dto.ChallengeUpdates,
		ReminderTime:     dto.ReminderTime,
		ReminderTimezone: dto.ReminderTimezone,
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "reminderTime") || strings.Contains(msg, "reminderTimezone") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// RegisterDevice handles POST /notifications/devices.
func (h *Handlers) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	dto, ok := requireDecodedBody[registerDeviceDTO](w, r)
	if !ok {
		return
	}
	req := RegisterDeviceRequest{Platform: dto.Platform, Token: dto.Token, DeviceID: dto.DeviceID}
	if msg := validateRegisterDevice(req); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := h.service.RegisterDevice(r.Context(), userID, req); err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

// UnregisterDevice handles DELETE /notifications/devices.
func (h *Handlers) UnregisterDevice(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())
	dto, outcome := decodeJSON[unregisterDeviceDTO](r)
	switch outcome {
	case decodeMalformed:
		writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
		return
	case decodeNull:
		writeError(w, http.StatusBadRequest, "DeviceId is required")
		return
	}
	if strings.TrimSpace(dto.DeviceID) == "" {
		writeError(w, http.StatusBadRequest, "DeviceId is required")
		return
	}
	if err := h.service.UnregisterDevice(r.Context(), userID, dto.DeviceID); err != nil {
		if errors.Is(err, ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		writeError(w, http.StatusInternalServerError, "Internal server error.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// VAPIDPublicKey handles GET /notifications/vapid-public-key (public).
func (h *Handlers) VAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	key := h.service.VAPIDPublicKey()
	if key == "" {
		writeError(w, http.StatusNotFound, "VAPID public key not configured")
		return
	}
	writeJSON(w, http.StatusOK, vapidPublicKeyResponse{PublicKey: key})
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
