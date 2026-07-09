package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

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
	// 400, distinct from the {"errors": {...}} validation shape. Message
	// text is verbatim AuthEndpoints.cs's Login: Results.BadRequest(new {
	// error = "Email/username and password are required." }) — the parity
	// harness diffs these strings.
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

// NewService wires a Service and registers its export section into
// exportReg under the name "auth" — see internal/export's doc comment for
// why this replaces the old GET /auth/internal/export/{userId} endpoint.
func NewService(pool *pgxpool.Pool, tokens *TokenService, registry *events.Registry, exportReg *export.Registry, logger *slog.Logger) *Service {
	s := &Service{
		pool:          pool,
		tokens:        tokens,
		registry:      registry,
		exportReg:     exportReg,
		exportLimiter: ratelimit.New(1, 60*time.Second),
		logger:        logger,
	}
	exportReg.Register("auth", s.exportSection)
	return s
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
		// Verbatim AuthEndpoints.cs: Results.Conflict(new { error = "Email already registered." })
		return AuthResult{}, fmt.Errorf("%w: Email already registered.", ErrConflict)
	}
	if taken, err := usernameExists(ctx, s.pool, usernameLower); err != nil {
		return AuthResult{}, err
	} else if taken {
		// Verbatim AuthEndpoints.cs: Results.Conflict(new { error = "Username already taken." })
		return AuthResult{}, fmt.Errorf("%w: Username already taken.", ErrConflict)
	}

	hash, err := HashPassword(password)
	if err != nil {
		return AuthResult{}, err
	}

	user, err := createUser(ctx, s.pool, emailLower, usernameLower, hash, trimToNil(displayName))
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
// 2 characters, matching SearchUsers's early-return in AuthEndpoints.cs.
func (s *Service) SearchUsers(ctx context.Context, query string) ([]UserSearchResult, error) {
	trimmed := strings.ToLower(strings.TrimSpace(query))
	if len(trimmed) < 2 {
		return []UserSearchResult{}, nil
	}
	return searchUsers(ctx, s.pool, trimmed, 20)
}

// Export assembles the full data export for userID: auth's own section
// plus every section other modules have registered, subject to a 1/60s
// per-user rate limit.
func (s *Service) Export(ctx context.Context, userID string) ([]export.ServiceExport, []string, error) {
	if !s.exportLimiter.Allow(userID) {
		return nil, nil, ErrRateLimited
	}

	_, found, err := findUserByID(ctx, s.pool, userID)
	if err != nil {
		return nil, nil, err
	}
	if !found {
		return nil, nil, ErrNotFound
	}

	services, warnings := s.exportReg.Export(ctx, userID)
	return services, warnings, nil
}

// authExportData is auth's own export.Section payload — profile data only,
// deliberately never the password hash (matching the PM REVIEW ADDENDUM:
// "check what auth exports... never the password hash").
type authExportData struct {
	UserID      string     `json:"userId"`
	Email       string     `json:"email"`
	Username    string     `json:"username"`
	DisplayName *string    `json:"displayName"`
	AvatarURL   *string    `json:"avatarUrl"`
	CreatedAt   time.Time  `json:"createdAt"`
	LastLoginAt *time.Time `json:"lastLoginAt"`
}

func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	user, found, err := findUserByID(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrNotFound
	}
	return authExportData{
		UserID:      user.ID,
		Email:       user.Email,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		CreatedAt:   user.CreatedAt,
		LastLoginAt: user.LastLoginAt,
	}, nil
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
