package activity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const feedEntryColumns = `id::text, created_at, updated_at, actor_id::text, event_type,
	data, idempotency_key, deleted_at`

func scanFeedEntry(row pgx.Row) (FeedEntry, error) {
	var e FeedEntry
	var data []byte
	err := row.Scan(
		&e.ID, &e.CreatedAt, &e.UpdatedAt, &e.ActorID, &e.EventType,
		&data, &e.IdempotencyKey, &e.DeletedAt,
	)
	if err != nil {
		return FeedEntry{}, err
	}
	if data != nil {
		e.Data = json.RawMessage(data)
	}
	return e, nil
}

// insertFeedEntry inserts a row; ON CONFLICT DO NOTHING on the unique
// idempotency_key partial index. Returns (entry, true, nil) when a row was
// inserted, (zero, false, nil) on a duplicate key skip.
func insertFeedEntry(ctx context.Context, db querier, actorID, eventType string, data json.RawMessage, idempotencyKey string) (FeedEntry, bool, error) {
	var dataArg any
	if data != nil {
		dataArg = []byte(data)
	}
	row := db.QueryRow(ctx, `
		INSERT INTO feed_entries (actor_id, event_type, data, idempotency_key)
		VALUES ($1::uuid, $2, $3::jsonb, $4)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING `+feedEntryColumns,
		actorID, eventType, dataArg, idempotencyKey,
	)
	entry, err := scanFeedEntry(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return FeedEntry{}, false, nil
	}
	if err != nil {
		return FeedEntry{}, false, fmt.Errorf("activity: inserting feed entry: %w", err)
	}
	return entry, true, nil
}

// listFeedBatch returns up to limit non-deleted entries for the given
// actors, older than before (exclusive) when before is non-nil, newest first.
func listFeedBatch(ctx context.Context, db querier, actorIDs []string, before *time.Time, limit int) ([]FeedEntry, error) {
	if len(actorIDs) == 0 || limit < 1 {
		return nil, nil
	}
	rows, err := db.Query(ctx, `
		SELECT `+feedEntryColumns+`
		FROM feed_entries
		WHERE deleted_at IS NULL
			AND actor_id = ANY($1::uuid[])
			AND ($2::timestamptz IS NULL OR created_at < $2)
		ORDER BY created_at DESC
		LIMIT $3`,
		actorIDs, before, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("activity: listing feed batch: %w", err)
	}
	defer rows.Close()

	var out []FeedEntry
	for rows.Next() {
		e, err := scanFeedEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("activity: scanning feed entry: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func softDeleteHabitEntries(ctx context.Context, db querier, actorID, habitID string) (int64, error) {
	tag, err := db.Exec(ctx, `
		UPDATE feed_entries
		SET deleted_at = now(), updated_at = now()
		WHERE actor_id = $1::uuid
			AND deleted_at IS NULL
			AND event_type IN ('habit.created', 'habit.completed')
			AND data IS NOT NULL
			AND data->>'habitId' = $2::text`,
		actorID, habitID,
	)
	if err != nil {
		return 0, fmt.Errorf("activity: soft-deleting habit feed entries: %w", err)
	}
	return tag.RowsAffected(), nil
}

func restoreHabitEntries(ctx context.Context, db querier, actorID, habitID string) (int64, error) {
	tag, err := db.Exec(ctx, `
		UPDATE feed_entries
		SET deleted_at = NULL, updated_at = now()
		WHERE actor_id = $1::uuid
			AND deleted_at IS NOT NULL
			AND event_type IN ('habit.created', 'habit.completed')
			AND data IS NOT NULL
			AND data->>'habitId' = $2::text`,
		actorID, habitID,
	)
	if err != nil {
		return 0, fmt.Errorf("activity: restoring habit feed entries: %w", err)
	}
	return tag.RowsAffected(), nil
}

func softDeleteFriendAcceptedEntries(ctx context.Context, db querier, userID1, userID2 string) (int64, error) {
	tag, err := db.Exec(ctx, `
		UPDATE feed_entries
		SET deleted_at = now(), updated_at = now()
		WHERE deleted_at IS NULL
			AND event_type = 'friend.request.accepted'
			AND (actor_id = $1::uuid OR actor_id = $2::uuid)
			AND data IS NOT NULL
			AND (
				(data->>'userId1' = $1::text AND data->>'userId2' = $2::text)
				OR (data->>'userId1' = $2::text AND data->>'userId2' = $1::text)
			)`,
		userID1, userID2,
	)
	if err != nil {
		return 0, fmt.Errorf("activity: soft-deleting friendship feed entries: %w", err)
	}
	return tag.RowsAffected(), nil
}

func hardDeleteActorEntries(ctx context.Context, db querier, userID string) (int64, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM feed_entries
		WHERE actor_id = $1::uuid`,
		userID,
	)
	if err != nil {
		return 0, fmt.Errorf("activity: hard-deleting actor feed entries: %w", err)
	}
	return tag.RowsAffected(), nil
}

func hardDeleteReferencingEntries(ctx context.Context, db querier, userID string) (int64, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM feed_entries
		WHERE actor_id != $1::uuid
			AND data IS NOT NULL
			AND (
				data->>'userId' = $1::text
				OR data->>'userId1' = $1::text
				OR data->>'userId2' = $1::text
				OR data->>'fromUserId' = $1::text
				OR data->>'toUserId' = $1::text
			)`,
		userID,
	)
	if err != nil {
		return 0, fmt.Errorf("activity: hard-deleting referencing feed entries: %w", err)
	}
	return tag.RowsAffected(), nil
}

func hasAnyActiveEntry(ctx context.Context, db querier, actorID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM feed_entries
			WHERE actor_id = $1::uuid AND deleted_at IS NULL
		)`, actorID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("activity: checking feed entries for export: %w", err)
	}
	return exists, nil
}

func listEntriesForExport(ctx context.Context, db querier, actorID string) ([]FeedEntry, error) {
	rows, err := db.Query(ctx, `
		SELECT `+feedEntryColumns+`
		FROM feed_entries
		WHERE actor_id = $1::uuid AND deleted_at IS NULL
		ORDER BY created_at DESC`,
		actorID,
	)
	if err != nil {
		return nil, fmt.Errorf("activity: listing feed entries for export: %w", err)
	}
	defer rows.Close()

	var out []FeedEntry
	for rows.Next() {
		e, err := scanFeedEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("activity: scanning export feed entry: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
