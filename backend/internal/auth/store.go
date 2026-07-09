package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is returned by store lookups that find no matching row.
var ErrNotFound = errors.New("auth: not found")

// ErrConflict is returned when a unique constraint (email or username)
// blocks an insert — including the race where two concurrent registrations
// both pass the pre-check SELECT and only one wins the unique index.
var ErrConflict = errors.New("auth: conflict")

const uniqueViolationCode = "23505"

// querier is satisfied by both *pgxpool.Pool and pgx.Tx, letting every
// function below run either directly against the pool or inside a
// caller-managed transaction (used by the password-change and
// account-delete flows, which need atomicity across more than one
// statement).
//
// IDs are carried as plain Go strings holding a Postgres uuid column's
// canonical text form, not a dedicated UUID type: every query below casts
// uuid columns to ::text on SELECT and casts string parameters to ::uuid
// on the placeholder side. This avoids adding a UUID library (e.g.
// google/uuid) or relying on pgx's binary uuid<->string codec behavior,
// for a module with a modest, hand-written query set — see the bead
// report for the sqlc-vs-hand-rolled-SQL tradeoff this same reasoning
// applies to.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const userColumns = `id::text, created_at, updated_at, email, username, password_hash, display_name, avatar_url, last_login_at`

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.CreatedAt, &u.UpdatedAt, &u.Email, &u.Username, &u.PasswordHash,
		&u.DisplayName, &u.AvatarURL, &u.LastLoginAt)
	return u, err
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolationCode
}

// createUser inserts a new user row. emailLower and usernameLower must
// already be trimmed and lowercased by the caller. It returns ErrConflict
// if the unique index on email or username rejects the insert (the
// definitive check — any pre-check SELECT the caller ran is only an
// optimization to fail fast with a clearer message before hitting the DB
// constraint).
func createUser(ctx context.Context, db querier, emailLower, usernameLower, passwordHash string, displayName *string) (User, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash, display_name)
		VALUES ($1, $2, $3, $4)
		RETURNING `+userColumns,
		emailLower, usernameLower, passwordHash, displayName)

	user, err := scanUser(row)
	if err != nil {
		if isUniqueViolation(err) {
			return User{}, ErrConflict
		}
		return User{}, fmt.Errorf("auth: inserting user: %w", err)
	}
	return user, nil
}

// emailOrUsernameExists reports whether emailLower or usernameLower is
// already taken, used to return a specific 409 message before attempting
// the insert (a friendlier error than a generic constraint-violation
// message, matching AuthEndpoints.cs's two separate pre-checks).
func emailExists(ctx context.Context, db querier, emailLower string) (bool, error) {
	return exists(ctx, db, `SELECT 1 FROM users WHERE email = $1`, emailLower)
}

func usernameExists(ctx context.Context, db querier, usernameLower string) (bool, error) {
	return exists(ctx, db, `SELECT 1 FROM users WHERE username = $1`, usernameLower)
}

func exists(ctx context.Context, db querier, sql string, arg string) (bool, error) {
	var one int
	err := db.QueryRow(ctx, sql, arg).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("auth: checking existence: %w", err)
	}
	return true, nil
}

// findUserByEmailOrUsername looks up a user by exact (already-lowercased)
// email or username match, used by Login.
func findUserByEmailOrUsername(ctx context.Context, db querier, input string) (User, bool, error) {
	row := db.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE email = $1 OR username = $1`, input)
	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, fmt.Errorf("auth: finding user by email or username: %w", err)
	}
	return user, true, nil
}

func findUserByID(ctx context.Context, db querier, id string) (User, bool, error) {
	row := db.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1::uuid`, id)
	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, fmt.Errorf("auth: finding user by id: %w", err)
	}
	return user, true, nil
}

func updateLastLogin(ctx context.Context, db querier, id string) error {
	_, err := db.Exec(ctx, `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("auth: updating last_login_at: %w", err)
	}
	return nil
}

// updateProfile writes the caller-resolved final DisplayName/AvatarURL
// (the service layer has already applied the "omit vs blank vs value"
// trim/validate rules from UpdateProfileRequest) and returns the updated
// row.
func updateProfile(ctx context.Context, db querier, id string, displayName, avatarURL *string) (User, bool, error) {
	row := db.QueryRow(ctx, `
		UPDATE users SET display_name = $2, avatar_url = $3, updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+userColumns,
		id, displayName, avatarURL)

	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, fmt.Errorf("auth: updating profile: %w", err)
	}
	return user, true, nil
}

func updatePasswordHash(ctx context.Context, db querier, id, passwordHash string) error {
	tag, err := db.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1::uuid`, id, passwordHash)
	if err != nil {
		return fmt.Errorf("auth: updating password hash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// deleteUser removes the user row (refresh_tokens cascade via the FK) and
// reports whether a row was found.
func deleteUser(ctx context.Context, db querier, id string) (bool, error) {
	tag, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id)
	if err != nil {
		return false, fmt.Errorf("auth: deleting user: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// searchUsers matches username or display_name case-insensitively
// (queryLower must already be lowercased and trimmed by the caller),
// ordered by username, capped at limit rows.
func searchUsers(ctx context.Context, db querier, queryLower string, limit int) ([]UserSearchResult, error) {
	rows, err := db.Query(ctx, `
		SELECT id::text, username, display_name, avatar_url
		FROM users
		WHERE username ILIKE '%' || $1 || '%' OR (display_name IS NOT NULL AND display_name ILIKE '%' || $1 || '%')
		ORDER BY username
		LIMIT $2`,
		queryLower, limit)
	if err != nil {
		return nil, fmt.Errorf("auth: searching users: %w", err)
	}
	defer rows.Close()

	results := []UserSearchResult{}
	for rows.Next() {
		var r UserSearchResult
		if err := rows.Scan(&r.ID, &r.Username, &r.DisplayName, &r.AvatarURL); err != nil {
			return nil, fmt.Errorf("auth: scanning search result: %w", err)
		}
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("auth: iterating search results: %w", err)
	}
	return results, nil
}

// resolveUsername looks up a user's id by (already-lowercased) username —
// the direct-call replacement for the old GET
// /auth/internal/resolve/{username} endpoint.
func resolveUsername(ctx context.Context, db querier, usernameLower string) (string, bool, error) {
	var id string
	err := db.QueryRow(ctx, `SELECT id::text FROM users WHERE username = $1`, usernameLower).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("auth: resolving username: %w", err)
	}
	return id, true, nil
}

// batchProfiles returns username/displayName for every id in ids that
// exists — the direct-call replacement for the old POST
// /auth/internal/profiles endpoint.
func batchProfiles(ctx context.Context, db querier, ids []string) ([]ProfileSummary, error) {
	rows, err := db.Query(ctx, `
		SELECT id::text, username, display_name
		FROM users
		WHERE id = ANY($1::uuid[])`,
		ids)
	if err != nil {
		return nil, fmt.Errorf("auth: batch-loading profiles: %w", err)
	}
	defer rows.Close()

	results := []ProfileSummary{}
	for rows.Next() {
		var p ProfileSummary
		if err := rows.Scan(&p.UserID, &p.Username, &p.DisplayName); err != nil {
			return nil, fmt.Errorf("auth: scanning batch profile: %w", err)
		}
		results = append(results, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("auth: iterating batch profiles: %w", err)
	}
	return results, nil
}

// --- refresh tokens ---

const refreshTokenColumns = `id::text, created_at, updated_at, user_id::text, token, expires_at, revoked_at`

func scanRefreshToken(row pgx.Row) (RefreshToken, error) {
	var rt RefreshToken
	err := row.Scan(&rt.ID, &rt.CreatedAt, &rt.UpdatedAt, &rt.UserID, &rt.Token, &rt.ExpiresAt, &rt.RevokedAt)
	return rt, err
}

func createRefreshToken(ctx context.Context, db querier, userID, token string, expiresAt time.Time) (RefreshToken, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO refresh_tokens (user_id, token, expires_at)
		VALUES ($1::uuid, $2, $3)
		RETURNING `+refreshTokenColumns,
		userID, token, expiresAt)

	rt, err := scanRefreshToken(row)
	if err != nil {
		return RefreshToken{}, fmt.Errorf("auth: inserting refresh token: %w", err)
	}
	return rt, nil
}

// findRefreshTokenForUpdate looks up a refresh token by its opaque value
// and locks the row (SELECT ... FOR UPDATE) so a concurrent refresh call
// using the same token cannot also observe it as not-yet-revoked — the
// transaction that commits first wins the rotation, the other sees it
// already revoked. Callers must run this inside a transaction.
func findRefreshTokenForUpdate(ctx context.Context, tx querier, token string) (RefreshToken, bool, error) {
	row := tx.QueryRow(ctx, `SELECT `+refreshTokenColumns+` FROM refresh_tokens WHERE token = $1 FOR UPDATE`, token)
	rt, err := scanRefreshToken(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return RefreshToken{}, false, nil
	}
	if err != nil {
		return RefreshToken{}, false, fmt.Errorf("auth: finding refresh token: %w", err)
	}
	return rt, true, nil
}

// findRefreshTokenByUserAndToken is the non-locking lookup Logout uses: it
// only needs to find and revoke one token, with no rotation race to guard
// against.
func findRefreshTokenByUserAndToken(ctx context.Context, db querier, userID, token string) (RefreshToken, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+refreshTokenColumns+` FROM refresh_tokens WHERE token = $1 AND user_id = $2::uuid`,
		token, userID)
	rt, err := scanRefreshToken(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return RefreshToken{}, false, nil
	}
	if err != nil {
		return RefreshToken{}, false, fmt.Errorf("auth: finding refresh token: %w", err)
	}
	return rt, true, nil
}

func revokeRefreshToken(ctx context.Context, db querier, id string) error {
	_, err := db.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now(), updated_at = now() WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("auth: revoking refresh token: %w", err)
	}
	return nil
}

func revokeAllUserRefreshTokens(ctx context.Context, db querier, userID string) error {
	_, err := db.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = now(), updated_at = now()
		WHERE user_id = $1::uuid AND revoked_at IS NULL`,
		userID)
	if err != nil {
		return fmt.Errorf("auth: revoking all refresh tokens: %w", err)
	}
	return nil
}
