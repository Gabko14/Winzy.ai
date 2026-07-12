package social

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const witnessLinkColumns = `id::text, created_at, updated_at, owner_id::text, token, label, revoked_at`

func scanWitnessLink(row pgx.Row) (WitnessLink, error) {
	var w WitnessLink
	err := row.Scan(&w.ID, &w.CreatedAt, &w.UpdatedAt, &w.OwnerID, &w.Token, &w.Label, &w.RevokedAt)
	if err != nil {
		return WitnessLink{}, err
	}
	return w, nil
}

// generateWitnessToken mints a cryptographically random 32-byte token,
// base64url-encoded without padding — matching
// WitnessLinkEndpoints.cs's GenerateWitnessToken exactly (43 characters).
func generateWitnessToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("social: generating witness token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func insertWitnessLink(ctx context.Context, db querier, ownerID, token string, label *string) (WitnessLink, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO witness_links (owner_id, token, label)
		VALUES ($1::uuid, $2, $3)
		RETURNING `+witnessLinkColumns,
		ownerID, token, label)
	w, err := scanWitnessLink(row)
	if err != nil {
		return WitnessLink{}, fmt.Errorf("social: inserting witness link: %w", err)
	}
	return w, nil
}

// findActiveWitnessLinkByOwner looks up a non-revoked link owned by ownerID
// — the shape UpdateWitnessLink/RevokeWitnessLink/RotateToken all query, so
// another owner (or a revoked link) 404s.
func findActiveWitnessLinkByOwner(ctx context.Context, db querier, id, ownerID string) (WitnessLink, bool, error) {
	row := db.QueryRow(ctx, `
		SELECT `+witnessLinkColumns+` FROM witness_links
		WHERE id = $1::uuid AND owner_id = $2::uuid AND revoked_at IS NULL`,
		id, ownerID)
	return scanOptionalWitnessLink(row)
}

func scanOptionalWitnessLink(row pgx.Row) (WitnessLink, bool, error) {
	w, err := scanWitnessLink(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return WitnessLink{}, false, nil
	}
	if err != nil {
		return WitnessLink{}, false, fmt.Errorf("social: finding witness link: %w", err)
	}
	return w, true, nil
}

// findWitnessLinkByToken looks up a witness link by token WITHOUT filtering
// on revoked_at — ViewWitnessLink's constant-time-404 contract depends on
// this running the SAME query (and therefore the same index lookup /
// row-or-no-row timing) for an unknown token and a revoked one; the caller
// checks RevokedAt itself afterward. See witness_service.go's
// ViewWitnessLink doc comment.
func findWitnessLinkByToken(ctx context.Context, db querier, token string) (WitnessLink, bool, error) {
	row := db.QueryRow(ctx, `SELECT `+witnessLinkColumns+` FROM witness_links WHERE token = $1`, token)
	return scanOptionalWitnessLink(row)
}

func listActiveWitnessLinksByOwner(ctx context.Context, db querier, ownerID string) ([]WitnessLink, error) {
	rows, err := db.Query(ctx, `
		SELECT `+witnessLinkColumns+` FROM witness_links
		WHERE owner_id = $1::uuid AND revoked_at IS NULL
		ORDER BY created_at DESC`,
		ownerID)
	if err != nil {
		return nil, fmt.Errorf("social: listing witness links: %w", err)
	}
	defer rows.Close()

	result := []WitnessLink{}
	for rows.Next() {
		w, err := scanWitnessLink(rows)
		if err != nil {
			return nil, fmt.Errorf("social: scanning witness link: %w", err)
		}
		result = append(result, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating witness links: %w", err)
	}
	return result, nil
}

func updateWitnessLinkLabel(ctx context.Context, db querier, id, label string) (WitnessLink, error) {
	row := db.QueryRow(ctx, `
		UPDATE witness_links SET label = $2, updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+witnessLinkColumns,
		id, label)
	w, err := scanWitnessLink(row)
	if err != nil {
		return WitnessLink{}, fmt.Errorf("social: updating witness link label: %w", err)
	}
	return w, nil
}

func revokeWitnessLinkRow(ctx context.Context, db querier, id string) error {
	if _, err := db.Exec(ctx, `UPDATE witness_links SET revoked_at = now(), updated_at = now() WHERE id = $1::uuid`, id); err != nil {
		return fmt.Errorf("social: revoking witness link: %w", err)
	}
	return nil
}

func rotateWitnessLinkToken(ctx context.Context, db querier, id, newToken string) (WitnessLink, error) {
	row := db.QueryRow(ctx, `
		UPDATE witness_links SET token = $2, updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+witnessLinkColumns,
		id, newToken)
	w, err := scanWitnessLink(row)
	if err != nil {
		return WitnessLink{}, fmt.Errorf("social: rotating witness link token: %w", err)
	}
	return w, nil
}

// deleteWitnessLinksForUser removes every witness link owned by userID —
// part of the UserDeleted cascade. witness_link_habits must be deleted first
// by the caller (deleteWitnessLinkHabitsForUser) even though the FK would
// cascade this automatically, so the cascade's own row counts stay accurate
// for logging, matching UserDeletedSubscriber.cs's explicit two-step delete.
func deleteWitnessLinksForUser(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM witness_links WHERE owner_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("social: deleting user witness links: %w", err)
	}
	return nil
}

// --- witness_link_habits (per-link habit allowlist) ---

func replaceWitnessLinkHabits(ctx context.Context, db querier, linkID string, habitIDs []string) error {
	if _, err := db.Exec(ctx, `DELETE FROM witness_link_habits WHERE witness_link_id = $1::uuid`, linkID); err != nil {
		return fmt.Errorf("social: clearing witness link habits: %w", err)
	}
	return insertWitnessLinkHabits(ctx, db, linkID, habitIDs)
}

// insertWitnessLinkHabits inserts one row per (already-deduplicated)
// habitID. Callers are expected to have deduplicated habitIDs first (see
// service.go's dedupeStrings) — CreateWitnessLink/UpdateWitnessLink both
// dedupe before ever reaching the store layer, matching
// `request.HabitIds.Distinct()` in WitnessLinkEndpoints.cs.
func insertWitnessLinkHabits(ctx context.Context, db querier, linkID string, habitIDs []string) error {
	for _, habitID := range habitIDs {
		if _, err := db.Exec(ctx, `
			INSERT INTO witness_link_habits (witness_link_id, habit_id) VALUES ($1::uuid, $2::uuid)`,
			linkID, habitID); err != nil {
			return fmt.Errorf("social: inserting witness link habit: %w", err)
		}
	}
	return nil
}

func witnessLinkHabitIDs(ctx context.Context, db querier, linkID string) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT habit_id::text FROM witness_link_habits WHERE witness_link_id = $1::uuid`, linkID)
	if err != nil {
		return nil, fmt.Errorf("social: listing witness link habits: %w", err)
	}
	defer rows.Close()

	result := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("social: scanning witness link habit: %w", err)
		}
		result = append(result, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating witness link habits: %w", err)
	}
	return result, nil
}

// witnessLinkHabitIDsForLinks returns every (linkID -> []habitID) mapping
// for the given link ids in one query — ListWitnessLinks' bulk projection.
func witnessLinkHabitIDsForLinks(ctx context.Context, db querier, linkIDs []string) (map[string][]string, error) {
	result := map[string][]string{}
	if len(linkIDs) == 0 {
		return result, nil
	}

	rows, err := db.Query(ctx, `
		SELECT witness_link_id::text, habit_id::text FROM witness_link_habits
		WHERE witness_link_id = ANY($1::uuid[])`,
		linkIDs)
	if err != nil {
		return nil, fmt.Errorf("social: listing witness link habits for links: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var linkID, habitID string
		if err := rows.Scan(&linkID, &habitID); err != nil {
			return nil, fmt.Errorf("social: scanning witness link habit row: %w", err)
		}
		result[linkID] = append(result[linkID], habitID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating witness link habit rows: %w", err)
	}
	return result, nil
}

// deleteWitnessLinkHabitsForUser removes every witness_link_habits row for
// every witness link userID owns — the UserDeleted cascade's first step
// (see deleteWitnessLinksForUser's doc comment for why this runs first even
// though the FK cascades it).
func deleteWitnessLinkHabitsForUser(ctx context.Context, db querier, userID string) error {
	if _, err := db.Exec(ctx, `
		DELETE FROM witness_link_habits
		WHERE witness_link_id IN (SELECT id FROM witness_links WHERE owner_id = $1::uuid)`,
		userID); err != nil {
		return fmt.Errorf("social: deleting user witness link habits: %w", err)
	}
	return nil
}
