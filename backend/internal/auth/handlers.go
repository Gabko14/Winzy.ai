package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Gabko14/winzy/backend/internal/httpserver"
)

const refreshCookieName = "refresh_token"

// Handlers wires HTTP handlers to a Service. Register with Routes.
type Handlers struct {
	service *Service
}

// NewHandlers returns Handlers backed by service.
func NewHandlers(service *Service) *Handlers {
	return &Handlers{service: service}
}

// isWebClient replicates AuthEndpoints.cs's IsWebClient: browsers send
// Sec-Fetch-Site on every request; its presence distinguishes a web client
// (refresh token travels exclusively via the httpOnly cookie) from a
// native/API client (refresh token travels in the JSON body). A caller
// that sends neither a Sec-Fetch-Site header nor an Origin (i.e. not a
// browser) falls back to the native behavior, matching the old comment
// "no header = native = token in body".
func isWebClient(r *http.Request) bool {
	return r.Header.Get("Sec-Fetch-Site") != ""
}

func setRefreshCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     "/auth",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/auth",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func refreshTokenFromRequest(r *http.Request, bodyToken *string) string {
	if cookie, err := r.Cookie(refreshCookieName); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	if bodyToken != nil {
		return *bodyToken
	}
	return ""
}

func buildAuthResponse(r *http.Request, result AuthResult) AuthResponse {
	resp := AuthResponse{
		AccessToken: result.AccessToken,
		User:        toProfile(result.User),
	}
	if !isWebClient(r) {
		token := result.RefreshToken
		resp.RefreshToken = &token
	}
	return resp
}

// decodeJSON decodes r.Body into T, treating an empty body as the zero
// value rather than an error — request DTOs in this module are either
// genuinely optional (RefreshRequestBody) or have every field validated
// separately anyway, so falling through to that validation on an empty
// body produces a clearer error than a generic "malformed body" message.
func decodeJSON[T any](r *http.Request) (T, error) {
	var v T
	if r.Body == nil {
		return v, nil
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&v); err != nil {
		if errors.Is(err, io.EOF) {
			return v, nil
		}
		return v, err
	}
	return v, nil
}

// Register handles POST /auth/register.
func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[RegisterRequest](r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Malformed request body.")
		return
	}

	result, err := h.service.Register(r.Context(), req.Email, req.Username, req.Password, req.DisplayName)
	if err != nil {
		writeAuthError(w, err)
		return
	}

	setRefreshCookie(w, result.RefreshToken, result.RefreshTokenExpiresAt)
	w.Header().Set("Location", "/auth/profile")
	writeJSON(w, http.StatusCreated, buildAuthResponse(r, result))
}

// Login handles POST /auth/login.
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[LoginRequest](r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Malformed request body.")
		return
	}

	result, err := h.service.Login(r.Context(), req.EmailOrUsername, req.Password)
	if err != nil {
		writeAuthError(w, err)
		return
	}

	setRefreshCookie(w, result.RefreshToken, result.RefreshTokenExpiresAt)
	writeJSON(w, http.StatusOK, buildAuthResponse(r, result))
}

// Refresh handles POST /auth/refresh: cookie first, then request body (for
// native clients), matching AuthEndpoints.cs's Refresh exactly.
func (h *Handlers) Refresh(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[RefreshRequestBody](r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Malformed request body.")
		return
	}

	tokenValue := refreshTokenFromRequest(r, req.RefreshToken)

	result, err := h.service.Refresh(r.Context(), tokenValue)
	if err != nil {
		writeAuthError(w, err)
		return
	}

	setRefreshCookie(w, result.RefreshToken, result.RefreshTokenExpiresAt)
	writeJSON(w, http.StatusOK, buildAuthResponse(r, result))
}

// Logout handles POST /auth/logout (protected route: userID comes from the
// JWT the auth middleware already validated).
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, _ := decodeJSON[RefreshRequestBody](r)
	tokenValue := refreshTokenFromRequest(r, req.RefreshToken)

	if err := h.service.Logout(r.Context(), userID, tokenValue); err != nil {
		writeAuthError(w, err)
		return
	}

	clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// GetProfile handles GET /auth/profile.
func (h *Handlers) GetProfile(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	user, err := h.service.GetProfile(r.Context(), userID)
	if err != nil {
		writeAuthError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, toProfile(user))
}

// UpdateProfile handles PUT /auth/profile.
func (h *Handlers) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, err := decodeJSON[UpdateProfileRequest](r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Malformed request body.")
		return
	}

	user, err := h.service.UpdateProfile(r.Context(), userID, req)
	if err != nil {
		writeAuthError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, toProfile(user))
}

// ChangePassword handles PUT /auth/password.
func (h *Handlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	req, err := decodeJSON[ChangePasswordRequest](r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Malformed request body.")
		return
	}

	if err := h.service.ChangePassword(r.Context(), userID, req.CurrentPassword, req.NewPassword); err != nil {
		writeAuthError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeleteAccount handles DELETE /auth/account.
func (h *Handlers) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	if err := h.service.DeleteAccount(r.Context(), userID); err != nil {
		writeAuthError(w, err)
		return
	}

	clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// SearchUsers handles GET /auth/users/search?q=.
func (h *Handlers) SearchUsers(w http.ResponseWriter, r *http.Request) {
	results, err := h.service.SearchUsers(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, results)
}

type exportResponse struct {
	ExportedAt time.Time     `json:"exportedAt"`
	Services   []exportEntry `json:"services"`
	Warnings   []string      `json:"warnings"`
}

type exportEntry struct {
	Service string `json:"service"`
	Data    any    `json:"data"`
}

// Export handles GET /auth/export.
func (h *Handlers) Export(w http.ResponseWriter, r *http.Request) {
	userID := httpserver.UserIDFromContext(r.Context())

	services, warnings, err := h.service.Export(r.Context(), userID)
	if err != nil {
		writeAuthError(w, err)
		return
	}

	entries := make([]exportEntry, len(services))
	for i, s := range services {
		entries[i] = exportEntry{Service: s.Service, Data: s.Data}
	}
	if warnings == nil {
		warnings = []string{}
	}

	writeJSON(w, http.StatusOK, exportResponse{
		ExportedAt: time.Now().UTC(),
		Services:   entries,
		Warnings:   warnings,
	})
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

// writeAuthError maps a Service error to the HTTP status/body contract
// documented on winzy.ai-rdc7.2: 409 {"error": "..."} for conflicts, 400
// {"errors": {field: [messages]}} for validation failures (the bead's
// COMPATIBILITY FACTS state 422, but the actual, tested C# behavior is 400
// — see the bead report's deviations section), 404 for not-found, 401 with
// no informative body for bad credentials, and 429 for the export rate
// limit.
func writeAuthError(w http.ResponseWriter, err error) {
	var verrs validationErrors
	switch {
	case errors.As(err, &verrs):
		writeJSON(w, http.StatusBadRequest, map[string]validationErrors{"errors": verrs})
	case errors.Is(err, ErrConflict):
		writeError(w, http.StatusConflict, conflictMessage(err))
	case errors.Is(err, ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
	case errors.Is(err, ErrInvalidCredentials):
		w.WriteHeader(http.StatusUnauthorized)
	case errors.Is(err, ErrMissingCredentials):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "Too many requests.")
	default:
		writeError(w, http.StatusInternalServerError, "Internal server error.")
	}
}

// conflictMessage extracts the human-readable suffix Service attaches to
// ErrConflict via fmt.Errorf("%w: message", ErrConflict).
func conflictMessage(err error) string {
	const prefix = "auth: conflict: "
	msg := err.Error()
	if len(msg) > len(prefix) && msg[:len(prefix)] == prefix {
		return msg[len(prefix):]
	}
	return "A conflict occurred."
}
