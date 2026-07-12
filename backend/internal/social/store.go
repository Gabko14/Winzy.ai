package social

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is returned by store lookups that find no matching row.
var ErrNotFound = errors.New("social: not found")

// ErrConflict is returned when a friend request would duplicate an existing
// relationship — the (user_id, friend_id) unique index backing the 409s
// SendFriendRequest returns. It is a bare sentinel with no user-facing
// message of its own (see conflictError below for the type that actually
// carries one) — a caller matching only via errors.Is(err, ErrConflict)
// still works whether the concrete error is this bare value or a
// *conflictError, since conflictError.Is treats them as equivalent.
var ErrConflict = errors.New("social: conflict")

// conflictError carries the specific, user-facing 409 message for a
// business-rule conflict ("Already friends", "Friend request already
// exists") while still satisfying errors.Is(err, ErrConflict) via its own Is
// method — replacing an earlier approach that wrapped ErrConflict with
// fmt.Errorf("%w: message", ...) and recovered the message by parsing the
// resulting string's "social: conflict: " prefix back out in handlers.go.
// That worked but made a bare ErrConflict (e.g. a lost-race unique
// violation with no attached message) a latent leak: had one ever reached
// writeSocialError unwrapped, the literal sentinel text "social: conflict"
// would have rendered as the user-facing message. A conflictError is the
// only path errors.Is(err, ErrConflict) can succeed via without also
// carrying an explicit message, making that leak structurally impossible.
type conflictError struct {
	msg string
}

func (e *conflictError) Error() string        { return e.msg }
func (e *conflictError) Is(target error) bool { return target == ErrConflict }

// newConflictError returns a *conflictError with msg as its user-facing
// text — the conflict-with-a-message constructor every conflict-producing
// call site should use in place of fmt.Errorf("%w: msg", ErrConflict).
func newConflictError(msg string) error {
	return &conflictError{msg: msg}
}

const uniqueViolationCode = "23505"

// querier is satisfied by both *pgxpool.Pool and pgx.Tx — see
// internal/habits/store.go's doc comment for the full rationale (also
// covering why ids are plain strings rather than a dedicated UUID type).
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolationCode
}

// --- friendships ---

const friendshipColumns = `id::text, created_at, updated_at, user_id::text, friend_id::text, status`

func scanFriendship(row pgx.Row) (Friendship, error) {
	var f Friendship
	var status string
	err := row.Scan(&f.ID, &f.CreatedAt, &f.UpdatedAt, &f.UserID, &f.FriendID, &status)
	if err != nil {
		return Friendship{}, err
	}
	f.Status = friendshipStatusFromDB(status)
	return f, nil
}

func scanOptionalFriendship(row pgx.Row) (Friendship, bool, error) {
	f, err := scanFriendship(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Friendship{}, false, nil
	}
	if err != nil {
		return Friendship{}, false, fmt.Errorf("social: finding friendship: %w", err)
	}
	return f, true, nil
}

// findFriendshipEitherDirection looks up a friendship row between a and b in
// either direction — used by SendFriendRequest's duplicate check and
// RemoveFriend's lookup, matching the C#'s identical OR-clause query.
func findFriendshipEitherDirection(ctx context.Context, db querier, a, b string) (Friendship, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+friendshipColumns+` FROM friendships
		WHERE (user_id = $1::uuid AND friend_id = $2::uuid) OR (user_id = $2::uuid AND friend_id = $1::uuid)
		LIMIT 1`,
		a, b)
	return scanOptionalFriendship(row)
}

func insertFriendship(ctx context.Context, db querier, userID, friendID string, status FriendshipStatus) (Friendship, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO friendships (user_id, friend_id, status)
		VALUES ($1::uuid, $2::uuid, $3)
		RETURNING `+friendshipColumns,
		userID, friendID, string(status))

	f, err := scanFriendship(row)
	if err != nil {
		if isUniqueViolation(err) {
			return Friendship{}, ErrConflict
		}
		return Friendship{}, fmt.Errorf("social: inserting friendship: %w", err)
	}
	return f, nil
}

// findPendingRequestForRecipient looks up a Pending friendship by id where
// friendID is the recipient — the shape AcceptFriendRequest/
// DeclineFriendRequest both query, so only the request's addressee can act
// on it (the sender attempting to accept/decline their own request 404s).
func findPendingRequestForRecipient(ctx context.Context, db querier, id, friendID string) (Friendship, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+friendshipColumns+` FROM friendships
		WHERE id = $1::uuid AND friend_id = $2::uuid AND status = 'Pending'`,
		id, friendID)
	return scanOptionalFriendship(row)
}

func acceptFriendship(ctx context.Context, db querier, id string) (Friendship, error) {
	row := db.QueryRow(ctx, `
		UPDATE friendships SET status = 'Accepted', updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+friendshipColumns,
		id)
	f, err := scanFriendship(row)
	if err != nil {
		return Friendship{}, fmt.Errorf("social: accepting friendship: %w", err)
	}
	return f, nil
}

func deleteFriendshipRow(ctx context.Context, db querier, id string) error {
	if _, err := db.Exec(ctx, `DELETE FROM friendships WHERE id = $1::uuid`, id); err != nil {
		return fmt.Errorf("social: deleting friendship: %w", err)
	}
	return nil
}

// deleteFriendshipBothDirections removes every friendship row between a and
// b (both directions once accepted) in ONE statement — atomic by
// construction, unlike a find-then-loop-delete that could observe a partial
// set if interrupted between individual deletes. Reports whether any row
// was actually removed, via the DELETE's own RowsAffected — RemoveFriend
// uses that instead of a separate existence check to decide 404 vs 204.
func deleteFriendshipBothDirections(ctx context.Context, db querier, a, b string) (bool, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM friendships
		WHERE (user_id = $1::uuid AND friend_id = $2::uuid) OR (user_id = $2::uuid AND friend_id = $1::uuid)`,
		a, b)
	if err != nil {
		return false, fmt.Errorf("social: deleting friendship both directions: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// countAcceptedFriends and listAcceptedFriends back GET /social/friends'
// pagination, matching ListFriends' CountAsync + OrderByDescending/Skip/Take
// in FriendEndpoints.cs.
func countAcceptedFriends(ctx context.Context, db querier, userID string) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT count(*) FROM friendships WHERE user_id = $1::uuid AND status = 'Accepted'`,
		userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("social: counting accepted friends: %w", err)
	}
	return count, nil
}

func listAcceptedFriends(ctx context.Context, db querier, userID string, page, pageSize int) ([]Friendship, error) {
	rows, err := db.Query(ctx, `
		SELECT `+friendshipColumns+` FROM friendships
		WHERE user_id = $1::uuid AND status = 'Accepted'
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`,
		userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("social: listing accepted friends: %w", err)
	}
	defer rows.Close()

	result := []Friendship{}
	for rows.Next() {
		f, err := scanFriendship(rows)
		if err != nil {
			return nil, fmt.Errorf("social: scanning friend: %w", err)
		}
		result = append(result, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating friends: %w", err)
	}
	return result, nil
}

func countPendingIncoming(ctx context.Context, db querier, userID string) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT count(*) FROM friendships WHERE friend_id = $1::uuid AND status = 'Pending'`,
		userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("social: counting pending requests: %w", err)
	}
	return count, nil
}

func listPendingIncoming(ctx context.Context, db querier, userID string) ([]Friendship, error) {
	return queryFriendships(ctx, db, `
		SELECT `+friendshipColumns+` FROM friendships
		WHERE friend_id = $1::uuid AND status = 'Pending'
		ORDER BY created_at DESC`, userID)
}

func listPendingOutgoing(ctx context.Context, db querier, userID string) ([]Friendship, error) {
	return queryFriendships(ctx, db, `
		SELECT `+friendshipColumns+` FROM friendships
		WHERE user_id = $1::uuid AND status = 'Pending'
		ORDER BY created_at DESC`, userID)
}

func queryFriendships(ctx context.Context, db querier, sql string, args ...any) ([]Friendship, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("social: querying friendships: %w", err)
	}
	defer rows.Close()

	result := []Friendship{}
	for rows.Next() {
		f, err := scanFriendship(rows)
		if err != nil {
			return nil, fmt.Errorf("social: scanning friendship row: %w", err)
		}
		result = append(result, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating friendship rows: %w", err)
	}
	return result, nil
}

// isAcceptedFriend reports whether a and b have a one-directional Accepted
// friendship row a->b (an accepted friendship always has both directions, so
// callers that only care about "does X see Y as a friend" query their own
// direction — matching GetFriendProfile/CheckFriendship's exact query shape).
func isAcceptedFriend(ctx context.Context, db querier, userID, friendID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM friendships WHERE user_id = $1::uuid AND friend_id = $2::uuid AND status = 'Accepted')`,
		userID, friendID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("social: checking friendship: %w", err)
	}
	return exists, nil
}

func acceptedFriendIDs(ctx context.Context, db querier, userID string) ([]string, error) {
	rows, err := db.Query(ctx, `
		SELECT friend_id::text FROM friendships WHERE user_id = $1::uuid AND status = 'Accepted'`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("social: listing friend ids: %w", err)
	}
	defer rows.Close()

	result := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("social: scanning friend id: %w", err)
		}
		result = append(result, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating friend ids: %w", err)
	}
	return result, nil
}

// deleteFriendshipsForUser removes every friendship row involving userID (as
// either party) — part of the UserDeleted cascade (see hooks.go).
func deleteFriendshipsForUser(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM friendships WHERE user_id = $1::uuid OR friend_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("social: deleting user friendships: %w", err)
	}
	return nil
}

// --- visibility settings ---

const visibilitySettingColumns = `id::text, created_at, updated_at, user_id::text, habit_id::text, visibility`

func scanVisibilitySetting(row pgx.Row) (VisibilitySetting, error) {
	var v VisibilitySetting
	var visibility string
	err := row.Scan(&v.ID, &v.CreatedAt, &v.UpdatedAt, &v.UserID, &v.HabitID, &visibility)
	if err != nil {
		return VisibilitySetting{}, err
	}
	v.Visibility = habitVisibilityFromDB(visibility)
	return v, nil
}

func findVisibilitySetting(ctx context.Context, db querier, userID, habitID string) (VisibilitySetting, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+visibilitySettingColumns+` FROM visibility_settings
		WHERE user_id = $1::uuid AND habit_id = $2::uuid`,
		userID, habitID)
	v, err := scanVisibilitySetting(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return VisibilitySetting{}, false, nil
	}
	if err != nil {
		return VisibilitySetting{}, false, fmt.Errorf("social: finding visibility setting: %w", err)
	}
	return v, true, nil
}

// upsertVisibilitySetting inserts or updates userID's visibility for
// habitID — SetHabitVisibility loads the existing row itself (to compute
// oldVisibility for the emitted event), so this always knows which branch to
// take rather than needing an ON CONFLICT upsert.
func upsertVisibilitySetting(ctx context.Context, db querier, userID, habitID string, visibility HabitVisibility, exists bool) (VisibilitySetting, error) {
	var row pgx.Row
	if exists {
		row = db.QueryRow(ctx, `
			UPDATE visibility_settings SET visibility = $3, updated_at = now()
			WHERE user_id = $1::uuid AND habit_id = $2::uuid
			RETURNING `+visibilitySettingColumns,
			userID, habitID, string(visibility))
	} else {
		row = db.QueryRow(ctx, `
			INSERT INTO visibility_settings (user_id, habit_id, visibility)
			VALUES ($1::uuid, $2::uuid, $3)
			RETURNING `+visibilitySettingColumns,
			userID, habitID, string(visibility))
	}
	v, err := scanVisibilitySetting(row)
	if err != nil {
		return VisibilitySetting{}, fmt.Errorf("social: upserting visibility setting: %w", err)
	}
	return v, nil
}

// insertVisibilitySettingIfAbsent is the HabitCreated hook's idempotent
// insert — ON CONFLICT DO NOTHING on the (user_id, habit_id) unique index,
// matching HabitCreatedSubscriber.cs's existence check.
func insertVisibilitySettingIfAbsent(ctx context.Context, db querier, userID, habitID string, visibility HabitVisibility) error {
	_, err := db.Exec(ctx, `
		INSERT INTO visibility_settings (user_id, habit_id, visibility)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (user_id, habit_id) DO NOTHING`,
		userID, habitID, string(visibility))
	if err != nil {
		return fmt.Errorf("social: inserting default visibility setting: %w", err)
	}
	return nil
}

// deleteVisibilitySetting removes the (userID, habitID) row if any — the
// HabitArchived hook, naturally idempotent on redelivery (a DELETE with no
// matching row is a no-op, not an error).
func deleteVisibilitySetting(ctx context.Context, db querier, userID, habitID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM visibility_settings WHERE user_id = $1::uuid AND habit_id = $2::uuid`, userID, habitID); err != nil {
		return fmt.Errorf("social: deleting visibility setting: %w", err)
	}
	return nil
}

func listVisibilitySettings(ctx context.Context, db querier, userID string) ([]VisibilitySetting, error) {
	rows, err := db.Query(ctx, `
		SELECT `+visibilitySettingColumns+` FROM visibility_settings WHERE user_id = $1::uuid`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("social: listing visibility settings: %w", err)
	}
	defer rows.Close()

	result := []VisibilitySetting{}
	for rows.Next() {
		v, err := scanVisibilitySetting(rows)
		if err != nil {
			return nil, fmt.Errorf("social: scanning visibility setting: %w", err)
		}
		result = append(result, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating visibility settings: %w", err)
	}
	return result, nil
}

// visibilityMapForUser returns userID's explicit visibility settings keyed
// by habit id — the shape every per-habit visibility lookup (friend profile
// filter, batch visibility, the cross-module visibility filter) needs.
func visibilityMapForUser(ctx context.Context, db querier, userID string) (map[string]HabitVisibility, error) {
	settings, err := listVisibilitySettings(ctx, db, userID)
	if err != nil {
		return nil, err
	}
	m := make(map[string]HabitVisibility, len(settings))
	for _, v := range settings {
		m[v.HabitID] = v.Visibility
	}
	return m, nil
}

func deleteVisibilitySettingsForUser(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM visibility_settings WHERE user_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("social: deleting user visibility settings: %w", err)
	}
	return nil
}

// --- social preferences ---

const preferenceColumns = `id::text, created_at, updated_at, user_id::text, default_habit_visibility`

func scanPreference(row pgx.Row) (SocialPreference, error) {
	var p SocialPreference
	var visibility string
	err := row.Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.UserID, &visibility)
	if err != nil {
		return SocialPreference{}, err
	}
	p.DefaultHabitVisibility = habitVisibilityFromDB(visibility)
	return p, nil
}

func findPreference(ctx context.Context, db querier, userID string) (SocialPreference, bool, error) {
	row := db.QueryRow(ctx, `SELECT `+preferenceColumns+` FROM social_preferences WHERE user_id = $1::uuid`, userID)
	p, err := scanPreference(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return SocialPreference{}, false, nil
	}
	if err != nil {
		return SocialPreference{}, false, fmt.Errorf("social: finding preference: %w", err)
	}
	return p, true, nil
}

func upsertPreference(ctx context.Context, db querier, userID string, visibility HabitVisibility, exists bool) (SocialPreference, error) {
	var row pgx.Row
	if exists {
		row = db.QueryRow(ctx, `
			UPDATE social_preferences SET default_habit_visibility = $2, updated_at = now()
			WHERE user_id = $1::uuid
			RETURNING `+preferenceColumns,
			userID, string(visibility))
	} else {
		row = db.QueryRow(ctx, `
			INSERT INTO social_preferences (user_id, default_habit_visibility)
			VALUES ($1::uuid, $2)
			RETURNING `+preferenceColumns,
			userID, string(visibility))
	}
	p, err := scanPreference(row)
	if err != nil {
		return SocialPreference{}, fmt.Errorf("social: upserting preference: %w", err)
	}
	return p, nil
}

// defaultVisibilityFor returns userID's default habit visibility preference,
// or Private if they have no preference row — the fallback every read of
// DefaultHabitVisibility applies (GetPreferences, GetBatchVisibility,
// GetFriendProfile, the cross-module visibility filter).
func defaultVisibilityFor(ctx context.Context, db querier, userID string) (HabitVisibility, error) {
	pref, found, err := findPreference(ctx, db, userID)
	if err != nil {
		return "", err
	}
	if !found {
		return VisibilityPrivate, nil
	}
	return pref.DefaultHabitVisibility, nil
}

func deletePreferencesForUser(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM social_preferences WHERE user_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("social: deleting user preferences: %w", err)
	}
	return nil
}

// --- shared cascade ---

// deleteUserData removes every social row for userID: witness link habits,
// witness links, preferences, visibility settings, and friendships (both
// directions) — the UserDeleted cascade, matching UserDeletedSubscriber.cs's
// deletion order exactly (FK-dependent rows first).
func deleteUserData(ctx context.Context, db querier, userID string) error {
	if err := deleteWitnessLinkHabitsForUser(ctx, db, userID); err != nil {
		return err
	}
	if err := deleteWitnessLinksForUser(ctx, db, userID); err != nil {
		return err
	}
	if err := deletePreferencesForUser(ctx, db, userID); err != nil {
		return err
	}
	if err := deleteVisibilitySettingsForUser(ctx, db, userID); err != nil {
		return err
	}
	if err := deleteFriendshipsForUser(ctx, db, userID); err != nil {
		return err
	}
	return nil
}
