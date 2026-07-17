package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
)

// Sentinel errors Handlers maps to specific HTTP responses.
var (
	// ErrInvalidCredentials covers wrong password, unknown user, and any
	// invalid/expired/revoked refresh token — deliberately
	// undifferentiated, matching Results.Unauthorized()'s empty body.
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	// ErrMissingCredentials is Login's specific "both fields required"
	// 400, distinct from the {"errors": {...}} validation shape.
	ErrMissingCredentials = errors.New("Email/username and password are required.")
	// ErrRateLimited is returned by Export when the per-user export rate
	// limit (1/60s) rejects the request.
	ErrRateLimited = errors.New("auth: rate limited")
)

// Error lets validationErrors be returned and matched as a plain error via
// errors.As, carrying the {"errors": {field: [messages]}} payload the
// frontend error mapper keys off (see validation.go's doc comment).
func (v validationErrors) Error() string { return "auth: validation failed" }

// Service is the auth module's business logic: it owns the DB pool, token
// issuance, the shared event hook registry, and the export-section
// registry, and is the sole entry point Handlers (and other in-process
// modules, via ResolveUsername/BatchProfiles) call into.
type Service struct {
	pool          *pgxpool.Pool
	tokens        *TokenService
	registry      *events.Registry
	exportReg     *export.Registry
	exportLimiter *ratelimit.Limiter
	logger        *slog.Logger
}

// NewService wires a Service. Unlike other modules, auth does NOT register
// an export section into exportReg: Export assembles the "auth" section
// itself from the user row its existence gate already fetched (see Export's
// doc comment), and the registry holds only the other modules' sections.
func NewService(pool *pgxpool.Pool, tokens *TokenService, registry *events.Registry, exportReg *export.Registry, logger *slog.Logger) *Service {
	return &Service{
		pool:          pool,
		tokens:        tokens,
		registry:      registry,
		exportReg:     exportReg,
		exportLimiter: ratelimit.New(1, 60*time.Second),
		logger:        logger,
	}
}

// AuthResult is the outcome of Register, Login, and Refresh: a fresh access
// token, a fresh refresh token, and the user it belongs to. Handlers decide
// whether the refresh token travels in the response body or exclusively in
// a cookie (the web-vs-native distinction lives at the HTTP layer, since it
// depends on request headers Service never sees).
type AuthResult struct {
	AccessToken           string
	RefreshToken          string
	RefreshTokenExpiresAt time.Time
	User                  User
}

// Register validates input, rejects duplicate email/username, creates the
// user, emits UserRegistered (a failure here is logged and does not fail
// registration — the user row already committed, matching
// AuthEndpoints.cs's try/catch around the NATS publish), and issues a
// fresh token pair.
func (s *Service) Register(ctx context.Context, email, username, password string, displayName *string) (AuthResult, error) {
	if errs := validateRegistration(email, username, password); errs != nil {
		return AuthResult{}, errs
	}

	emailLower := strings.ToLower(strings.TrimSpace(email))
	usernameLower := strings.ToLower(strings.TrimSpace(username))

	if taken, err := emailExists(ctx, s.pool, emailLower); err != nil {
		return AuthResult{}, err
	} else if taken {
		return AuthResult{}, fmt.Errorf("%w: Email already registered.", ErrConflict)
	}
	if taken, err := usernameExists(ctx, s.pool, usernameLower); err != nil {
		return AuthResult{}, err
	} else if taken {
		return AuthResult{}, fmt.Errorf("%w: Username already taken.", ErrConflict)
	}

	hash, err := HashPassword(password)
	if err != nil {
		return AuthResult{}, err
	}

	user, err := createUser(ctx, s.pool, emailLower, usernameLower, hash, trimPointer(displayName))
	if err != nil {
		// isUniqueViolation races land here even after the pre-checks above.
		return AuthResult{}, err
	}

	if err := events.Emit(ctx, s.registry, events.UserRegistered{UserID: user.ID, Username: user.Username}); err != nil {
		s.logger.ErrorContext(ctx, "user.registered handler failed; registration already committed", "user_id", user.ID, "error", err)
	}

	return s.issueAuthResult(ctx, user)
}

// Login verifies credentials by exact (already-lowercased) email or
// username match, updates LastLoginAt, and issues a fresh token pair.
func (s *Service) Login(ctx context.Context, emailOrUsername, password string) (AuthResult, error) {
	if strings.TrimSpace(emailOrUsername) == "" || password == "" {
		return AuthResult{}, ErrMissingCredentials
	}

	input := strings.ToLower(strings.TrimSpace(emailOrUsername))
	user, found, err := findUserByEmailOrUsername(ctx, s.pool, input)
	if err != nil {
		return AuthResult{}, err
	}
	if !found || !VerifyPassword(password, user.PasswordHash) {
		return AuthResult{}, ErrInvalidCredentials
	}

	if err := updateLastLogin(ctx, s.pool, user.ID); err != nil {
		return AuthResult{}, err
	}

	return s.issueAuthResult(ctx, user)
}

// Refresh validates and single-use-rotates a refresh token: the old token
// is locked (SELECT ... FOR UPDATE) and revoked, a new one issued, all in
// one transaction so a concurrent reuse of the same token cannot also
// succeed.
func (s *Service) Refresh(ctx context.Context, tokenValue string) (AuthResult, error) {
	if strings.TrimSpace(tokenValue) == "" {
		return AuthResult{}, ErrInvalidCredentials
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AuthResult{}, fmt.Errorf("auth: beginning refresh transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	existing, found, err := findRefreshTokenForUpdate(ctx, tx, tokenValue)
	if err != nil {
		return AuthResult{}, err
	}
	if !found || existing.IsRevoked() || !existing.ExpiresAt.After(time.Now().UTC()) {
		return AuthResult{}, ErrInvalidCredentials
	}

	user, found, err := findUserByID(ctx, tx, existing.UserID)
	if err != nil {
		return AuthResult{}, err
	}
	if !found {
		return AuthResult{}, ErrInvalidCredentials
	}

	if err := revokeRefreshToken(ctx, tx, existing.ID); err != nil {
		return AuthResult{}, err
	}

	newToken, err := s.tokens.GenerateRefreshToken()
	if err != nil {
		return AuthResult{}, err
	}
	newRT, err := createRefreshToken(ctx, tx, user.ID, newToken, time.Now().UTC().Add(s.tokens.RefreshTokenLifetime()))
	if err != nil {
		return AuthResult{}, err
	}

	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email)
	if err != nil {
		return AuthResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return AuthResult{}, fmt.Errorf("auth: committing refresh transaction: %w", err)
	}

	return AuthResult{
		AccessToken:           accessToken,
		RefreshToken:          newRT.Token,
		RefreshTokenExpiresAt: newRT.ExpiresAt,
		User:                  user,
	}, nil
}

// Logout revokes tokenValue if it belongs to userID and is not already
// revoked; a missing or already-revoked token is silently ignored, matching
// AuthEndpoints.cs's Logout (it always returns 204 regardless).
func (s *Service) Logout(ctx context.Context, userID, tokenValue string) error {
	if strings.TrimSpace(tokenValue) == "" {
		return nil
	}
	rt, found, err := findRefreshTokenByUserAndToken(ctx, s.pool, userID, tokenValue)
	if err != nil {
		return err
	}
	if !found || rt.IsRevoked() {
		return nil
	}
	return revokeRefreshToken(ctx, s.pool, rt.ID)
}

// GetProfile returns ErrNotFound if userID (already authenticated by the
// JWT middleware) no longer has a row — e.g. the account was deleted after
// the token was issued.
func (s *Service) GetProfile(ctx context.Context, userID string) (User, error) {
	user, found, err := findUserByID(ctx, s.pool, userID)
	if err != nil {
		return User{}, err
	}
	if !found {
		return User{}, ErrNotFound
	}
	return user, nil
}

// UpdateProfile applies UpdateProfileRequest's "omitted vs blank vs value"
// rules exactly as UpdateProfile in AuthEndpoints.cs does: a nil field
// leaves the current value untouched, an explicit blank clears it to null,
// and AvatarURL must additionally be a valid absolute http(s) URL.
func (s *Service) UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (User, error) {
	user, found, err := findUserByID(ctx, s.pool, userID)
	if err != nil {
		return User{}, err
	}
	if !found {
		return User{}, ErrNotFound
	}

	displayName := user.DisplayName
	if req.DisplayName != nil {
		displayName = trimToNil(req.DisplayName)
	}

	avatarURL := user.AvatarURL
	if req.AvatarURL != nil {
		trimmed := strings.TrimSpace(*req.AvatarURL)
		switch {
		case trimmed == "":
			avatarURL = nil
		case isValidHTTPURL(trimmed):
			avatarURL = &trimmed
		default:
			return User{}, validationErrors{"avatarUrl": []string{"AvatarUrl must be a valid HTTP(S) URL."}}
		}
	}

	updated, found, err := updateProfile(ctx, s.pool, userID, displayName, avatarURL)
	if err != nil {
		return User{}, err
	}
	if !found {
		return User{}, ErrNotFound
	}
	return updated, nil
}

// ChangePassword verifies currentPassword, then atomically updates the
// hash and revokes every outstanding refresh token for the user.
func (s *Service) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	if errs := validateChangePassword(newPassword); errs != nil {
		return errs
	}

	user, found, err := findUserByID(ctx, s.pool, userID)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}

	if !VerifyPassword(currentPassword, user.PasswordHash) {
		return validationErrors{"currentPassword": []string{"Current password is incorrect."}}
	}

	newHash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("auth: beginning password-change transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := updatePasswordHash(ctx, tx, userID, newHash); err != nil {
		return err
	}
	if err := revokeAllUserRefreshTokens(ctx, tx, userID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("auth: committing password-change transaction: %w", err)
	}
	return nil
}

// DeleteAccount deletes the user row and emits UserDeleted inside one
// transaction, with that same transaction threaded through ctx via
// db.WithQuerier before Emit runs. Every registered UserDeleted handler that
// resolves its querier via db.QuerierFrom(ctx, ...) — the contract documented
// on internal/events — therefore writes through this transaction rather than
// its own pool connection: the user row and every module's cascade delete
// commit or roll back together. A handler failure aborts dispatch and this
// method rolls back the whole transaction, so a failed cascade never leaves
// the user row deleted with orphaned data elsewhere, and a successful
// cascade is never partially applied by a handler that ran before the
// failure. This closes the gap winzy.ai-rdc7.13 was filed to fix: before it,
// habits' UserDeleted handler wrote over its own pool connection outside
// this transaction, so a failing commit here could delete the user's habits
// while leaving the account row in place.
func (s *Service) DeleteAccount(ctx context.Context, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("auth: beginning account-delete transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := deleteUserAvatar(ctx, tx, userID); err != nil {
		return err
	}

	found, err := deleteUser(ctx, tx, userID)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}

	if err := events.Emit(db.WithQuerier(ctx, tx), s.registry, events.UserDeleted{UserID: userID}); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("auth: committing account-delete transaction: %w", err)
	}
	return nil
}

// SearchUsers returns an empty (never nil) slice for a query shorter than
// 2 characters.
func (s *Service) SearchUsers(ctx context.Context, query string) ([]UserSearchResult, error) {
	if utf8.RuneCountInString(query) < 2 {
		return []UserSearchResult{}, nil
	}
	trimmed := strings.ToLower(strings.TrimSpace(query))
	return searchUsers(ctx, s.pool, trimmed, 20)
}

// Export assembles the full data export for userID: auth's own section,
// built directly from the user row the existence gate below fetched,
// prepended to every section other modules have registered — subject to a
// 1/60s per-user rate limit. Auth's section is deliberately NOT a
// registered export.Section: it used to be, and its own fetch of the same
// user row raced the gate's — if DELETE /auth/account landed between the
// two queries, the gate had already passed (200, not 404) while the
// section's fetch came back not-found, an error the registry can't
// distinguish from a genuine module failure, so it degraded "auth" to a
// warning instead of the whole export 404ing (winzy.ai-ibxb). Building the
// section from the gate's single fetch closes that window by construction:
// the same query result both gates existence and supplies the exported
// data, so there is no second query left to race against a concurrent
// delete. Prepending preserves the response order from when "auth" was the
// registry's first registration.
func (s *Service) Export(ctx context.Context, userID string) ([]export.ServiceExport, []string, error) {
	if !s.exportLimiter.Allow(userID) {
		return nil, nil, ErrRateLimited
	}

	user, found, err := findUserByID(ctx, s.pool, userID)
	if err != nil {
		return nil, nil, err
	}
	if !found {
		return nil, nil, ErrNotFound
	}

	others, warnings := s.exportReg.Export(ctx, userID)
	services := append([]export.ServiceExport{{Service: "auth", Data: s.newAuthExportData(ctx, user)}}, others...)
	return services, warnings, nil
}

// authExportAvatar is the optional blob payload nested under auth's export
// section when the user has an uploaded avatar.
type authExportAvatar struct {
	ContentType string `json:"contentType"`
	Data        string `json:"data"`
}

// authExportData is auth's own export.Section payload — profile data only,
// deliberately never the password hash (matching the PM REVIEW ADDENDUM:
// "check what auth exports... never the password hash").
type authExportData struct {
	UserID      string            `json:"userId"`
	Email       string            `json:"email"`
	Username    string            `json:"username"`
	DisplayName *string           `json:"displayName"`
	AvatarURL   *string           `json:"avatarUrl"`
	Avatar      *authExportAvatar `json:"avatar,omitempty"`
	CreatedAt   time.Time         `json:"createdAt"`
	LastLoginAt *time.Time        `json:"lastLoginAt"`
}

// newAuthExportData builds the "auth" section payload from an
// already-fetched user — plus the avatar blob when present. Avatar lookup
// failure degrades to omitting the blob (still exporting profile fields)
// rather than failing the whole export.
func (s *Service) newAuthExportData(ctx context.Context, user User) authExportData {
	data := authExportData{
		UserID:      user.ID,
		Email:       user.Email,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		CreatedAt:   user.CreatedAt,
		LastLoginAt: user.LastLoginAt,
	}
	avatar, found, err := findUserAvatar(ctx, s.pool, user.ID)
	if err != nil {
		s.logger.WarnContext(ctx, "auth export: avatar lookup failed", "user_id", user.ID, "error", err)
		return data
	}
	if found {
		data.Avatar = &authExportAvatar{
			ContentType: avatar.ContentType,
			Data:        encodeBase64(avatar.Data),
		}
	}
	return data
}

// UploadAvatar validates and stores raw image bytes for userID, sets
// users.avatar_url to the public serving path, and returns cache-busting
// metadata for the client.
func (s *Service) UploadAvatar(ctx context.Context, userID, contentType string, body io.Reader) (AvatarUploadResponse, error) {
	data, storedType, err := validateAvatarBytes(contentType, body)
	if err != nil {
		return AvatarUploadResponse{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AvatarUploadResponse{}, fmt.Errorf("auth: beginning avatar upload transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	avatar, err := upsertUserAvatar(ctx, tx, userID, data, storedType)
	if err != nil {
		return AvatarUploadResponse{}, err
	}
	path := avatarServingPath(userID)
	if err := setUserAvatarURL(ctx, tx, userID, &path); err != nil {
		return AvatarUploadResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AvatarUploadResponse{}, fmt.Errorf("auth: committing avatar upload: %w", err)
	}
	return AvatarUploadResponse{AvatarURL: path, UpdatedAt: avatar.UpdatedAt}, nil
}

// GetAvatar returns the stored avatar bytes for userID, or ErrNotFound.
func (s *Service) GetAvatar(ctx context.Context, userID string) (UserAvatar, error) {
	avatar, found, err := findUserAvatar(ctx, s.pool, userID)
	if err != nil {
		return UserAvatar{}, err
	}
	if !found {
		return UserAvatar{}, ErrNotFound
	}
	return avatar, nil
}

// DeleteAvatar removes the avatar row and nulls users.avatar_url. Idempotent:
// missing avatar still succeeds (and still clears avatar_url if set).
func (s *Service) DeleteAvatar(ctx context.Context, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("auth: beginning avatar delete transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := deleteUserAvatar(ctx, tx, userID); err != nil {
		return err
	}
	if err := setUserAvatarURL(ctx, tx, userID, nil); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("auth: committing avatar delete: %w", err)
	}
	return nil
}

// ResolveUsername is the direct-call replacement for the old GET
// /auth/internal/resolve/{username} endpoint — other in-process modules
// call this instead of an HTTP round-trip.
func (s *Service) ResolveUsername(ctx context.Context, username string) (string, bool, error) {
	return resolveUsername(ctx, s.pool, strings.ToLower(strings.TrimSpace(username)))
}

// BatchProfiles is the direct-call replacement for the old POST
// /auth/internal/profiles endpoint: up to 100 deduplicated ids.
func (s *Service) BatchProfiles(ctx context.Context, userIDs []string) ([]ProfileSummary, error) {
	ids := dedupeCap(userIDs, 100)
	if len(ids) == 0 {
		return []ProfileSummary{}, nil
	}
	return batchProfiles(ctx, s.pool, ids)
}

func (s *Service) issueAuthResult(ctx context.Context, user User) (AuthResult, error) {
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email)
	if err != nil {
		return AuthResult{}, err
	}
	refreshToken, err := s.tokens.GenerateRefreshToken()
	if err != nil {
		return AuthResult{}, err
	}
	rt, err := createRefreshToken(ctx, s.pool, user.ID, refreshToken, time.Now().UTC().Add(s.tokens.RefreshTokenLifetime()))
	if err != nil {
		return AuthResult{}, err
	}
	return AuthResult{
		AccessToken:           accessToken,
		RefreshToken:          rt.Token,
		RefreshTokenExpiresAt: rt.ExpiresAt,
		User:                  user,
	}, nil
}

func encodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func trimToNil(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func trimPointer(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	return &trimmed
}

func isValidHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return u.IsAbs() && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func dedupeCap(ids []string, max int) []string {
	seen := make(map[string]bool, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
		if len(result) >= max {
			break
		}
	}
	return result
}
