package challenges

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is returned by store lookups that find no matching row.
var ErrNotFound = errors.New("challenges: not found")

// ErrConflict is the unique-active index sentinel.
var ErrConflict = errors.New("challenges: conflict")

const uniqueViolationCode = "23505"

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolationCode
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isValidUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

const challengeColumns = `id::text, created_at, updated_at, habit_id::text, creator_id::text, recipient_id::text,
	milestone_type, target_value, period_days, reward_description, status, current_progress,
	ends_at, completed_at, claimed_at, completion_count, processed_completion_dates::text,
	custom_start_date, custom_end_date, baseline_consistency`

func scanChallenge(row pgx.Row) (Challenge, error) {
	var c Challenge
	var milestone, status string
	var processed *string
	err := row.Scan(
		&c.ID, &c.CreatedAt, &c.UpdatedAt, &c.HabitID, &c.CreatorID, &c.RecipientID,
		&milestone, &c.TargetValue, &c.PeriodDays, &c.RewardDescription, &status, &c.CurrentProgress,
		&c.EndsAt, &c.CompletedAt, &c.ClaimedAt, &c.CompletionCount, &processed,
		&c.CustomStartDate, &c.CustomEndDate, &c.BaselineConsistency,
	)
	if err != nil {
		return Challenge{}, err
	}
	c.MilestoneType = milestoneTypeFromDB(milestone)
	c.Status = challengeStatusFromDB(status)
	c.ProcessedCompletionDates = processed
	return c, nil
}

func scanOptionalChallenge(row pgx.Row) (Challenge, bool, error) {
	c, err := scanChallenge(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Challenge{}, false, nil
	}
	if err != nil {
		return Challenge{}, false, fmt.Errorf("challenges: finding challenge: %w", err)
	}
	return c, true, nil
}

func expireStaleActive(ctx context.Context, db querier, creatorID, recipientID, habitID string, now time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE challenges
		SET status = 'Expired', updated_at = $5
		WHERE creator_id = $1::uuid AND recipient_id = $2::uuid AND habit_id = $3::uuid
			AND status = 'Active' AND ends_at <= $4`,
		creatorID, recipientID, habitID, now, now)
	if err != nil {
		return fmt.Errorf("challenges: expiring stale active challenges: %w", err)
	}
	return nil
}

func insertChallenge(ctx context.Context, db querier, c Challenge) (Challenge, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO challenges (
			habit_id, creator_id, recipient_id, milestone_type, target_value, period_days,
			reward_description, status, current_progress, ends_at, custom_start_date, custom_end_date
		) VALUES (
			$1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
			$7, $8, $9, $10, $11, $12
		) RETURNING `+challengeColumns,
		c.HabitID, c.CreatorID, c.RecipientID, string(c.MilestoneType), c.TargetValue, c.PeriodDays,
		c.RewardDescription, string(c.Status), c.CurrentProgress, c.EndsAt, c.CustomStartDate, c.CustomEndDate,
	)
	created, err := scanChallenge(row)
	if err != nil {
		if isUniqueViolation(err) {
			return Challenge{}, ErrConflict
		}
		return Challenge{}, fmt.Errorf("challenges: inserting challenge: %w", err)
	}
	return created, nil
}

func findChallengeForUser(ctx context.Context, db querier, id, userID string) (Challenge, bool, error) {
	if !isValidUUID(id) {
		return Challenge{}, false, nil
	}
	row := db.QueryRow(ctx, `
		SELECT `+challengeColumns+` FROM challenges
		WHERE id = $1::uuid AND (creator_id = $2::uuid OR recipient_id = $2::uuid)`,
		id, userID)
	return scanOptionalChallenge(row)
}

func findChallengeForCreator(ctx context.Context, db querier, id, creatorID string) (Challenge, bool, error) {
	if !isValidUUID(id) {
		return Challenge{}, false, nil
	}
	row := db.QueryRow(ctx, `
		SELECT `+challengeColumns+` FROM challenges
		WHERE id = $1::uuid AND creator_id = $2::uuid`,
		id, creatorID)
	return scanOptionalChallenge(row)
}

func updateChallengeClaimed(ctx context.Context, db querier, id string, claimedAt time.Time) (Challenge, bool, error) {
	// Status guard is deliberate hardening beyond C# parity (same spirit as
	// resolvePromise in promise_store.go) — two concurrent claims must not
	// both succeed.
	row := db.QueryRow(ctx, `
		UPDATE challenges
		SET status = 'Claimed', claimed_at = $2, updated_at = $2
		WHERE id = $1::uuid AND status = 'Completed'
		RETURNING `+challengeColumns,
		id, claimedAt)
	return scanOptionalChallenge(row)
}

func updateChallengeCancelled(ctx context.Context, db querier, id string, now time.Time) (bool, error) {
	tag, err := db.Exec(ctx, `
		UPDATE challenges SET status = 'Cancelled', updated_at = $2
		WHERE id = $1::uuid AND status NOT IN ('Completed', 'Claimed')`,
		id, now)
	if err != nil {
		return false, fmt.Errorf("challenges: cancelling challenge: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func updateChallengeProgress(ctx context.Context, db querier, c Challenge, now time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE challenges SET
			current_progress = $2,
			completion_count = $3,
			processed_completion_dates = $4::jsonb,
			baseline_consistency = $5,
			status = $6,
			completed_at = $7,
			updated_at = $8
		WHERE id = $1::uuid`,
		c.ID, c.CurrentProgress, c.CompletionCount, c.ProcessedCompletionDates,
		c.BaselineConsistency, string(c.Status), c.CompletedAt, now,
	)
	if err != nil {
		return fmt.Errorf("challenges: updating progress: %w", err)
	}
	return nil
}

func listActiveForHabitRecipient(ctx context.Context, db querier, habitID, recipientID string, now time.Time) ([]Challenge, error) {
	rows, err := db.Query(ctx, `
		SELECT `+challengeColumns+` FROM challenges
		WHERE habit_id = $1::uuid AND recipient_id = $2::uuid
			AND status = 'Active' AND ends_at > $3`,
		habitID, recipientID, now)
	if err != nil {
		return nil, fmt.Errorf("challenges: listing active challenges: %w", err)
	}
	defer rows.Close()
	return collectChallenges(rows)
}

type listFilter struct {
	UserID string
	Status *ChallengeStatus
	Since  *time.Time
	Now    time.Time
	Page   int
	Size   int
}

func countChallenges(ctx context.Context, db querier, f listFilter) (int, error) {
	query, args := buildListWhere(f)
	var total int
	err := db.QueryRow(ctx, `SELECT COUNT(*) FROM challenges WHERE `+query, args...).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("challenges: counting challenges: %w", err)
	}
	return total, nil
}

func listChallenges(ctx context.Context, db querier, f listFilter) ([]Challenge, error) {
	where, args := buildListWhere(f)
	offset := (f.Page - 1) * f.Size
	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	args = append(args, f.Size, offset)
	rows, err := db.Query(ctx, fmt.Sprintf(`
		SELECT %s FROM challenges
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, challengeColumns, where, limitIdx, offsetIdx),
		args...)
	if err != nil {
		return nil, fmt.Errorf("challenges: listing challenges: %w", err)
	}
	defer rows.Close()
	return collectChallenges(rows)
}

func buildListWhere(f listFilter) (string, []any) {
	args := []any{f.UserID}
	where := `(creator_id = $1::uuid OR recipient_id = $1::uuid)`
	n := 2
	if f.Status != nil {
		switch *f.Status {
		case StatusActive:
			where += fmt.Sprintf(` AND status = 'Active' AND ends_at > $%d`, n)
			args = append(args, f.Now)
			n++
		case StatusExpired:
			where += fmt.Sprintf(` AND (status = 'Expired' OR (status = 'Active' AND ends_at <= $%d))`, n)
			args = append(args, f.Now)
			n++
		default:
			where += fmt.Sprintf(` AND status = $%d`, n)
			args = append(args, string(*f.Status))
			n++
		}
	}
	if f.Since != nil {
		where += fmt.Sprintf(` AND updated_at >= $%d`, n)
		args = append(args, *f.Since)
	}
	return where, args
}

func collectChallenges(rows pgx.Rows) ([]Challenge, error) {
	result := []Challenge{}
	for rows.Next() {
		c, err := scanChallenge(rows)
		if err != nil {
			return nil, fmt.Errorf("challenges: scanning challenge: %w", err)
		}
		result = append(result, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("challenges: iterating challenges: %w", err)
	}
	return result, nil
}

func hasAnyChallenge(ctx context.Context, db querier, userID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM challenges WHERE creator_id = $1::uuid OR recipient_id = $1::uuid
		)`, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("challenges: checking challenge existence: %w", err)
	}
	return exists, nil
}

func listChallengesForExport(ctx context.Context, db querier, userID string) ([]Challenge, error) {
	rows, err := db.Query(ctx, `
		SELECT `+challengeColumns+` FROM challenges
		WHERE creator_id = $1::uuid OR recipient_id = $1::uuid
		ORDER BY created_at DESC`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("challenges: listing challenges for export: %w", err)
	}
	defer rows.Close()
	return collectChallenges(rows)
}

func deleteUserChallenges(ctx context.Context, db querier, userID string) (int64, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM challenges WHERE creator_id = $1::uuid OR recipient_id = $1::uuid`,
		userID)
	if err != nil {
		return 0, fmt.Errorf("challenges: deleting user challenges: %w", err)
	}
	return tag.RowsAffected(), nil
}
