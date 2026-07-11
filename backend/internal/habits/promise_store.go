package habits

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const promiseColumns = `id::text, created_at, updated_at, user_id::text, habit_id::text, target_consistency, end_date, private_note, status, is_public_on_flame, resolved_at`

func scanPromise(row pgx.Row) (Promise, error) {
	var p Promise
	var status string
	err := row.Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt, &p.UserID, &p.HabitID, &p.TargetConsistency,
		&p.EndDate, &p.PrivateNote, &status, &p.IsPublicOnFlame, &p.ResolvedAt)
	if err != nil {
		return Promise{}, err
	}
	p.Status = promiseStatusFromDB(status)
	return p, nil
}

func scanOptionalPromise(row pgx.Row) (Promise, bool, error) {
	p, err := scanPromise(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Promise{}, false, nil
	}
	if err != nil {
		return Promise{}, false, fmt.Errorf("habits: finding promise: %w", err)
	}
	return p, true, nil
}

// insertPromise inserts a new Active promise, returning ErrPromiseConflict
// if the (user_id, habit_id) partial unique index rejects it — the
// definitive check backing "an active promise already exists"; the service
// layer's own pre-check (findActivePromise) exists only to fail fast with
// the same message on the common (non-racing) path.
func insertPromise(ctx context.Context, db querier, p Promise) (Promise, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO promises (user_id, habit_id, target_consistency, end_date, private_note, status, is_public_on_flame)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
		RETURNING `+promiseColumns,
		p.UserID, p.HabitID, p.TargetConsistency, p.EndDate, p.PrivateNote, string(p.Status), p.IsPublicOnFlame)

	inserted, err := scanPromise(row)
	if err != nil {
		if isUniqueViolation(err) {
			return Promise{}, ErrPromiseConflict
		}
		return Promise{}, fmt.Errorf("habits: inserting promise: %w", err)
	}
	return inserted, nil
}

// findActivePromise looks up the single Active promise (if any) for
// (userID, habitID) — the partial unique index guarantees at most one.
func findActivePromise(ctx context.Context, db querier, userID, habitID string) (Promise, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+promiseColumns+` FROM promises
		WHERE user_id = $1::uuid AND habit_id = $2::uuid AND status = 'Active'`,
		userID, habitID)
	return scanOptionalPromise(row)
}

// promiseHistory returns every non-Active promise for (userID, habitID),
// newest-resolved-first, matching GetPromise's history query in
// PromiseEndpoints.cs.
func promiseHistory(ctx context.Context, db querier, userID, habitID string) ([]Promise, error) {
	rows, err := db.Query(ctx, `
		SELECT `+promiseColumns+` FROM promises
		WHERE user_id = $1::uuid AND habit_id = $2::uuid AND status <> 'Active'
		ORDER BY resolved_at DESC`,
		userID, habitID)
	if err != nil {
		return nil, fmt.Errorf("habits: listing promise history: %w", err)
	}
	defer rows.Close()

	result := []Promise{}
	for rows.Next() {
		p, err := scanPromise(rows)
		if err != nil {
			return nil, fmt.Errorf("habits: scanning promise history row: %w", err)
		}
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("habits: iterating promise history: %w", err)
	}
	return result, nil
}

// resolvePromise transitions an Active promise to status and stamps
// resolvedAt — shared by GetPromise's lazy Kept/EndedBelow resolution and
// cancelPromiseRow's Cancelled transition.
// resolvePromise transitions promise id from Active to status, returning
// found=false (not an error) instead of overwriting it if the row is no
// longer Active — the guard against a race the C# doesn't have (EF Core's
// SaveChanges would happily overwrite a Kept/EndedBelow/Cancelled row with
// whatever this call is trying to set, e.g. a concurrent
// DELETE /habits/{id} cancels-then-archives a promise between a caller's
// own findActivePromise read and this UPDATE, or two concurrent lazy
// resolutions race each other). This is a deliberate hardening beyond
// parity, in the same spirit as winzy.ai-rdc7.13's transactional-cascade
// fix — not something the C# source does, called out here because callers
// (GetPromise's lazy resolution, CancelPromise, cancelActivePromiseForArchive)
// all need to treat "lost the race" as "already resolved," not as a 500.
func resolvePromise(ctx context.Context, db querier, id string, status PromiseStatus, resolvedAt time.Time) (Promise, bool, error) {
	row := db.QueryRow(ctx, `
		UPDATE promises SET status = $2, resolved_at = $3, updated_at = now()
		WHERE id = $1::uuid AND status = 'Active'
		RETURNING `+promiseColumns,
		id, string(status), resolvedAt)

	p, found, err := scanOptionalPromise(row)
	if err != nil {
		return Promise{}, false, fmt.Errorf("habits: resolving promise: %w", err)
	}
	return p, found, nil
}

// cancelPromiseRow transitions an Active promise to Cancelled — CancelPromise
// and the archive-cancels-promise integration point (service.go's
// ArchiveHabit) both funnel through this. See resolvePromise's doc comment
// for the status guard and what a lost race (found=false) means here.
func cancelPromiseRow(ctx context.Context, db querier, id string, resolvedAt time.Time) (Promise, bool, error) {
	return resolvePromise(ctx, db, id, PromiseCancelled, resolvedAt)
}

// setPromiseVisibility updates IsPublicOnFlame on an existing promise.
func setPromiseVisibility(ctx context.Context, db querier, id string, isPublicOnFlame bool) (Promise, error) {
	row := db.QueryRow(ctx, `
		UPDATE promises SET is_public_on_flame = $2, updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+promiseColumns,
		id, isPublicOnFlame)

	p, err := scanPromise(row)
	if err != nil {
		return Promise{}, fmt.Errorf("habits: updating promise visibility: %w", err)
	}
	return p, nil
}

// publicPromisesForHabits returns, for every habit in habitIDs, its single
// Active promise with IsPublicOnFlame set and EndDate not yet passed today
// (in UTC — the share-surface contract), keyed by habit id. An
// expired-but-unresolved promise is filtered out here rather than resolved,
// matching InternalEndpoints.cs's InternalGetUserHabits comment:
// auto-resolution is lazy (triggered only by the owner's GET), so a
// public/share surface must not show a promise that has technically ended
// but hasn't been resolved yet.
func publicPromisesForHabits(ctx context.Context, db querier, userID string, habitIDs []string, today time.Time) (map[string]Promise, error) {
	result := map[string]Promise{}
	if len(habitIDs) == 0 {
		return result, nil
	}

	rows, err := db.Query(ctx, `
		SELECT `+promiseColumns+` FROM promises
		WHERE user_id = $1::uuid AND status = 'Active' AND is_public_on_flame
			AND end_date >= $2 AND habit_id = ANY($3::uuid[])`,
		userID, today, habitIDs)
	if err != nil {
		return nil, fmt.Errorf("habits: listing public promises: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		p, err := scanPromise(rows)
		if err != nil {
			return nil, fmt.Errorf("habits: scanning public promise: %w", err)
		}
		result[p.HabitID] = p
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("habits: iterating public promises: %w", err)
	}
	return result, nil
}

// cancelActivePromiseForArchive cancels habitID's active promise (if any) as
// part of archiving it — the integration point ArchiveHabit's doc comment in
// service.go describes. A no-op (not an error) when there is no active
// promise, matching DeleteHabit in HabitEndpoints.cs, which only cancels
// `if (activePromise is not null)`.
func cancelActivePromiseForArchive(ctx context.Context, db querier, userID, habitID string, now time.Time) error {
	promise, found, err := findActivePromise(ctx, db, userID, habitID)
	if err != nil {
		return err
	}
	if !found {
		return nil
	}
	// A lost race (found=false — something else already transitioned this
	// promise out of Active between the read above and this write) is a
	// no-op here too: there is nothing left for archiving to cancel.
	_, _, err = cancelPromiseRow(ctx, db, promise.ID, now)
	return err
}

// deletePromisesForUser removes every promise owned by userID — part of the
// UserDeleted cascade (see deleteUserData in store.go), run before habits
// are deleted so this delete has no ordering dependency on
// promises.habit_id's own ON DELETE CASCADE.
func deletePromisesForUser(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM promises WHERE user_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("habits: deleting user promises: %w", err)
	}
	return nil
}

// promisesForExport returns every promise (any status) for habitID, oldest
// first — the data-export query (export.go), which includes full owner
// detail regardless of status or visibility.
func promisesForExport(ctx context.Context, db querier, habitID string) ([]Promise, error) {
	rows, err := db.Query(ctx, `
		SELECT `+promiseColumns+` FROM promises
		WHERE habit_id = $1::uuid
		ORDER BY created_at`,
		habitID)
	if err != nil {
		return nil, fmt.Errorf("habits: listing promises for export: %w", err)
	}
	defer rows.Close()

	result := []Promise{}
	for rows.Next() {
		p, err := scanPromise(rows)
		if err != nil {
			return nil, fmt.Errorf("habits: scanning promise for export: %w", err)
		}
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("habits: iterating promises for export: %w", err)
	}
	return result, nil
}
