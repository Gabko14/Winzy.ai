package habits

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is returned by store lookups that find no matching row.
var ErrNotFound = errors.New("habits: not found")

// ErrConflict is returned when a completion already exists for a
// (habit_id, local_date) pair — the unique index backing "duplicate
// completion" 409s.
var ErrConflict = errors.New("habits: conflict")

const uniqueViolationCode = "23505"

// querier is satisfied by both *pgxpool.Pool and pgx.Tx — see
// internal/auth/store.go's doc comment for the full rationale (also
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

const habitColumns = `id::text, created_at, updated_at, user_id::text, name, icon, color, frequency, custom_days, minimum_description, archived_at`

func scanHabit(row pgx.Row) (Habit, error) {
	var h Habit
	var frequency string
	var customDays []int
	err := row.Scan(&h.ID, &h.CreatedAt, &h.UpdatedAt, &h.UserID, &h.Name, &h.Icon, &h.Color,
		&frequency, &customDays, &h.MinimumDescription, &h.ArchivedAt)
	if err != nil {
		return Habit{}, err
	}
	h.Frequency = frequencyFromDB(frequency)
	h.CustomDays = customDays
	return h, nil
}

// customDaysParam boxes days into an `any` that is a genuine untyped nil
// when days is nil, rather than a non-nil interface wrapping a nil slice —
// pgx only recognizes the former as "encode this parameter as SQL NULL"
// for the jsonb column, not a typed nil []int.
func customDaysParam(days []int) any {
	if days == nil {
		return nil
	}
	return days
}

func createHabit(ctx context.Context, db querier, userID string, req CreateHabitRequest, frequency Frequency, customDays []int) (Habit, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO habits (user_id, name, icon, color, frequency, custom_days, minimum_description)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
		RETURNING `+habitColumns,
		userID, req.Name, trimPtr(req.Icon), trimPtr(req.Color), frequency.dbValue(), customDaysParam(customDays), trimToNil(req.MinimumDescription))

	h, err := scanHabit(row)
	if err != nil {
		return Habit{}, fmt.Errorf("habits: inserting habit: %w", err)
	}
	return h, nil
}

// listHabits returns userID's non-archived habits ordered by creation time,
// matching HabitEndpoints.cs's ListHabits.
func listHabits(ctx context.Context, db querier, userID string) ([]Habit, error) {
	rows, err := db.Query(ctx, `
		SELECT `+habitColumns+` FROM habits
		WHERE user_id = $1::uuid AND archived_at IS NULL
		ORDER BY created_at`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("habits: listing habits: %w", err)
	}
	defer rows.Close()

	result := []Habit{}
	for rows.Next() {
		h, err := scanHabit(rows)
		if err != nil {
			return nil, fmt.Errorf("habits: scanning habit: %w", err)
		}
		result = append(result, h)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("habits: iterating habits: %w", err)
	}
	return result, nil
}

// findActiveHabit looks up a non-archived habit owned by userID — used by
// every read/write path except archiving itself, which must still find an
// already-archived habit (idempotent re-archive).
func findActiveHabit(ctx context.Context, db querier, userID, id string) (Habit, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+habitColumns+` FROM habits
		WHERE id = $1::uuid AND user_id = $2::uuid AND archived_at IS NULL`,
		id, userID)
	return scanOptionalHabit(row)
}

// findHabitAnyArchiveState looks up a habit owned by userID regardless of
// archive state — DeleteHabit (archive) uses this so re-archiving an
// already-archived habit still succeeds, matching DeleteHabit's query in
// HabitEndpoints.cs (which has no ArchivedAt filter, unlike every other
// lookup).
func findHabitAnyArchiveState(ctx context.Context, db querier, userID, id string) (Habit, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+habitColumns+` FROM habits
		WHERE id = $1::uuid AND user_id = $2::uuid`,
		id, userID)
	return scanOptionalHabit(row)
}

func scanOptionalHabit(row pgx.Row) (Habit, bool, error) {
	h, err := scanHabit(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Habit{}, false, nil
	}
	if err != nil {
		return Habit{}, false, fmt.Errorf("habits: finding habit: %w", err)
	}
	return h, true, nil
}

func updateHabit(ctx context.Context, db querier, h Habit) (Habit, error) {
	row := db.QueryRow(ctx, `
		UPDATE habits SET name = $2, icon = $3, color = $4, frequency = $5, custom_days = $6,
			minimum_description = $7, updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+habitColumns,
		h.ID, h.Name, h.Icon, h.Color, h.Frequency.dbValue(), customDaysParam(h.CustomDays), h.MinimumDescription)

	updated, err := scanHabit(row)
	if err != nil {
		return Habit{}, fmt.Errorf("habits: updating habit: %w", err)
	}
	return updated, nil
}

// archiveHabit sets archived_at (idempotent: re-archiving just refreshes
// the timestamp), matching DeleteHabit's soft-delete in HabitEndpoints.cs.
func archiveHabit(ctx context.Context, db querier, id string) (Habit, error) {
	row := db.QueryRow(ctx, `
		UPDATE habits SET archived_at = now(), updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+habitColumns,
		id)

	h, err := scanHabit(row)
	if err != nil {
		return Habit{}, fmt.Errorf("habits: archiving habit: %w", err)
	}
	return h, nil
}

// --- completions ---

const completionColumns = `id::text, created_at, updated_at, habit_id::text, user_id::text, completed_at, local_date, completion_kind, note`

func scanCompletion(row pgx.Row) (Completion, error) {
	var c Completion
	var kind string
	err := row.Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt, &c.HabitID, &c.UserID, &c.CompletedAt, &c.LocalDate, &kind, &c.Note)
	if err != nil {
		return Completion{}, err
	}
	c.CompletionKind = completionKindFromDB(kind)
	return c, nil
}

// createCompletion inserts a new completion row. It returns ErrConflict if
// the (habit_id, local_date) unique index rejects the insert — the
// definitive check; callers may also pre-check with completionExists to
// fail fast with a clearer flow, but this is what actually enforces it.
func createCompletion(ctx context.Context, db querier, habitID, userID string, localDate time.Time, kind CompletionKind) (Completion, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO completions (habit_id, user_id, completed_at, local_date, completion_kind)
		VALUES ($1::uuid, $2::uuid, now(), $3, $4)
		RETURNING `+completionColumns,
		habitID, userID, localDate, kind.dbValue())

	c, err := scanCompletion(row)
	if err != nil {
		if isUniqueViolation(err) {
			return Completion{}, ErrConflict
		}
		return Completion{}, fmt.Errorf("habits: inserting completion: %w", err)
	}
	return c, nil
}

func completionExists(ctx context.Context, db querier, habitID string, localDate time.Time) (bool, error) {
	var one int
	err := db.QueryRow(ctx, `SELECT 1 FROM completions WHERE habit_id = $1::uuid AND local_date = $2`, habitID, localDate).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("habits: checking completion existence: %w", err)
	}
	return true, nil
}

// findCompletionByHabitDateUser looks up a completion the way
// DeleteCompletion/UpdateCompletion do in CompletionEndpoints.cs — scoped
// directly by (habit_id, local_date, user_id) on the completions table
// itself (Completion carries its own denormalized UserId), with no join
// back to habits.
func findCompletionByHabitDateUser(ctx context.Context, db querier, habitID string, localDate time.Time, userID string) (Completion, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+completionColumns+` FROM completions
		WHERE habit_id = $1::uuid AND local_date = $2 AND user_id = $3::uuid`,
		habitID, localDate, userID)
	c, err := scanCompletion(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Completion{}, false, nil
	}
	if err != nil {
		return Completion{}, false, fmt.Errorf("habits: finding completion: %w", err)
	}
	return c, true, nil
}

func deleteCompletionRow(ctx context.Context, db querier, id string) error {
	_, err := db.Exec(ctx, `DELETE FROM completions WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("habits: deleting completion: %w", err)
	}
	return nil
}

func updateCompletionKind(ctx context.Context, db querier, id string, kind CompletionKind) (Completion, error) {
	row := db.QueryRow(ctx, `
		UPDATE completions SET completion_kind = $2, updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+completionColumns,
		id, kind.dbValue())

	c, err := scanCompletion(row)
	if err != nil {
		return Completion{}, fmt.Errorf("habits: updating completion kind: %w", err)
	}
	return c, nil
}

// habitCompletionOnDate is one row of GetCompletionsByDate's per-habit
// projection — an active habit joined (via a correlated LEFT JOIN LATERAL)
// with at most one completion on the queried date.
type habitCompletionOnDate struct {
	Habit          Habit
	Completed      bool
	CompletionKind *string
}

// habitColumnsQualified is habitColumns with an explicit "h." table alias —
// needed (unlike every other query in this file) because
// completionsForDate joins habits against completions, and both tables
// have columns named id/created_at/updated_at/user_id; Postgres rejects an
// unqualified reference to any of them as ambiguous.
const habitColumnsQualified = `h.id::text, h.created_at, h.updated_at, h.user_id::text, h.name, h.icon, h.color, h.frequency, h.custom_days, h.minimum_description, h.archived_at`

// completionsForDate returns every active habit for userID plus whether
// (and with what kind) it was completed on localDate, matching
// GetCompletionsByDate in CompletionEndpoints.cs.
func completionsForDate(ctx context.Context, db querier, userID string, localDate time.Time) ([]habitCompletionOnDate, error) {
	rows, err := db.Query(ctx, `
		SELECT `+habitColumnsQualified+`, c.completion_kind
		FROM habits h
		LEFT JOIN completions c ON c.habit_id = h.id AND c.local_date = $2
		WHERE h.user_id = $1::uuid AND h.archived_at IS NULL
		ORDER BY h.created_at`,
		userID, localDate)
	if err != nil {
		return nil, fmt.Errorf("habits: listing completions for date: %w", err)
	}
	defer rows.Close()

	result := []habitCompletionOnDate{}
	for rows.Next() {
		var h Habit
		var frequency string
		var customDays []int
		var kind *string
		if err := rows.Scan(&h.ID, &h.CreatedAt, &h.UpdatedAt, &h.UserID, &h.Name, &h.Icon, &h.Color,
			&frequency, &customDays, &h.MinimumDescription, &h.ArchivedAt, &kind); err != nil {
			return nil, fmt.Errorf("habits: scanning completion-for-date row: %w", err)
		}
		h.Frequency = frequencyFromDB(frequency)
		h.CustomDays = customDays

		entry := habitCompletionOnDate{Habit: h, Completed: kind != nil}
		if kind != nil {
			wire := completionKindFromDB(*kind).String()
			entry.CompletionKind = &wire
		}
		result = append(result, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("habits: iterating completions for date: %w", err)
	}
	return result, nil
}

// habitCompletionDates returns the (local_date, kind) of every completion for
// habitID, ordered by date — the minimal projection the consistency engine
// and the stats endpoint consume, matching the C#'s
// `db.Completions.Where(c => c.HabitId == id).Select(c => new { c.LocalDate,
// c.CompletionKind })`. The C# query carries no ORDER BY (EF returns physical
// order); this ports it with an explicit `ORDER BY local_date` so the stats
// endpoint's completedDates array is deterministic — the calculator itself is
// order-independent (it keys completions into a map), so ordering changes no
// computed number. See the bead report's deviations for this one intentional
// difference from the source.
func habitCompletionDates(ctx context.Context, db querier, habitID string) ([]DatedCompletion, error) {
	rows, err := db.Query(ctx, `
		SELECT local_date, completion_kind FROM completions
		WHERE habit_id = $1::uuid
		ORDER BY local_date`,
		habitID)
	if err != nil {
		return nil, fmt.Errorf("habits: listing completion dates: %w", err)
	}
	defer rows.Close()

	result := []DatedCompletion{}
	for rows.Next() {
		var localDate time.Time
		var kind string
		if err := rows.Scan(&localDate, &kind); err != nil {
			return nil, fmt.Errorf("habits: scanning completion date: %w", err)
		}
		result = append(result, DatedCompletion{LocalDate: localDate, Kind: completionKindFromDB(kind)})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("habits: iterating completion dates: %w", err)
	}
	return result, nil
}

// deleteUserData removes every completion and habit owned by userID, in
// that order to respect the completions -> habits FK — the UserDeleted
// event handler's cascade, matching UserDeletedSubscriber.cs.
func deleteUserData(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM completions WHERE user_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("habits: deleting user completions: %w", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM habits WHERE user_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("habits: deleting user habits: %w", err)
	}
	return nil
}
