package challenges

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const inviteColumns = `id::text, created_at, updated_at, creator_id::text, token,
	habit_name, habit_icon, habit_frequency, habit_custom_days, milestone_type,
	target_value, period_days, reward_description, status,
	claimed_by::text, claimed_at, expires_at`

func scanInvite(row pgx.Row) (ChallengeInvite, error) {
	var inv ChallengeInvite
	var milestone, status string
	var customDaysRaw []byte
	var claimedBy *string
	err := row.Scan(
		&inv.ID, &inv.CreatedAt, &inv.UpdatedAt, &inv.CreatorID, &inv.Token,
		&inv.HabitName, &inv.HabitIcon, &inv.HabitFrequency, &customDaysRaw, &milestone,
		&inv.TargetValue, &inv.PeriodDays, &inv.RewardDescription, &status,
		&claimedBy, &inv.ClaimedAt, &inv.ExpiresAt,
	)
	if err != nil {
		return ChallengeInvite{}, err
	}
	inv.MilestoneType = milestoneTypeFromDB(milestone)
	inv.Status = inviteStatusFromDB(status)
	inv.ClaimedBy = claimedBy
	if len(customDaysRaw) > 0 && string(customDaysRaw) != "null" {
		if err := json.Unmarshal(customDaysRaw, &inv.HabitCustomDays); err != nil {
			return ChallengeInvite{}, fmt.Errorf("challenges: decoding invite custom_days: %w", err)
		}
	}
	return inv, nil
}

func inviteStatusFromDB(s string) InviteStatus {
	switch InviteStatus(s) {
	case InviteStatusClaimed:
		return InviteStatusClaimed
	case InviteStatusRevoked:
		return InviteStatusRevoked
	default:
		return InviteStatusPending
	}
}

func scanOptionalInvite(row pgx.Row) (ChallengeInvite, bool, error) {
	inv, err := scanInvite(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return ChallengeInvite{}, false, nil
	}
	if err != nil {
		return ChallengeInvite{}, false, fmt.Errorf("challenges: finding invite: %w", err)
	}
	return inv, true, nil
}

// generateInviteToken mints a cryptographically random 32-byte token,
// base64url-encoded without padding — matching generateWitnessToken
// (social/witness_store.go) exactly (43 characters).
func generateInviteToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("challenges: generating invite token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func customDaysJSON(days []int) any {
	if len(days) == 0 {
		return nil
	}
	return days
}

func insertInvite(ctx context.Context, db querier, inv ChallengeInvite) (ChallengeInvite, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO challenge_invites (
			creator_id, token, habit_name, habit_icon, habit_frequency, habit_custom_days,
			milestone_type, target_value, period_days, reward_description, status, expires_at
		) VALUES (
			$1::uuid, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11, $12
		) RETURNING `+inviteColumns,
		inv.CreatorID, inv.Token, inv.HabitName, inv.HabitIcon, inv.HabitFrequency, customDaysJSON(inv.HabitCustomDays),
		string(inv.MilestoneType), inv.TargetValue, inv.PeriodDays, inv.RewardDescription, string(inv.Status), inv.ExpiresAt,
	)
	created, err := scanInvite(row)
	if err != nil {
		if isUniqueViolation(err) {
			return ChallengeInvite{}, ErrConflict
		}
		return ChallengeInvite{}, fmt.Errorf("challenges: inserting invite: %w", err)
	}
	return created, nil
}

func countPendingInvitesByCreator(ctx context.Context, db querier, creatorID string) (int, error) {
	var n int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM challenge_invites
		WHERE creator_id = $1::uuid AND status = 'pending'`,
		creatorID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("challenges: counting pending invites: %w", err)
	}
	return n, nil
}

func listPendingInvitesByCreator(ctx context.Context, db querier, creatorID string) ([]ChallengeInvite, error) {
	rows, err := db.Query(ctx, `
		SELECT `+inviteColumns+` FROM challenge_invites
		WHERE creator_id = $1::uuid AND status = 'pending'
		ORDER BY created_at DESC`,
		creatorID)
	if err != nil {
		return nil, fmt.Errorf("challenges: listing pending invites: %w", err)
	}
	defer rows.Close()
	return collectInvites(rows)
}

func collectInvites(rows pgx.Rows) ([]ChallengeInvite, error) {
	var out []ChallengeInvite
	for rows.Next() {
		inv, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("challenges: iterating invites: %w", err)
	}
	if out == nil {
		out = []ChallengeInvite{}
	}
	return out, nil
}

// findInviteByToken looks up an invite by token WITHOUT filtering on status —
// ViewInvite's constant-time-404 contract for unknown vs known tokens depends
// on this running the SAME query for either outcome; the caller branches on
// Status / ExpiresAt afterward. Mirrors findWitnessLinkByToken.
func findInviteByToken(ctx context.Context, db querier, token string) (ChallengeInvite, bool, error) {
	row := db.QueryRow(ctx, `SELECT `+inviteColumns+` FROM challenge_invites WHERE token = $1`, token)
	return scanOptionalInvite(row)
}

func revokeInvite(ctx context.Context, db querier, id, creatorID string, now time.Time) (bool, error) {
	tag, err := db.Exec(ctx, `
		UPDATE challenge_invites
		SET status = 'revoked', updated_at = $3
		WHERE id = $1::uuid AND creator_id = $2::uuid`,
		id, creatorID, now)
	if err != nil {
		return false, fmt.Errorf("challenges: revoking invite: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func listPendingInvitesForExport(ctx context.Context, db querier, creatorID string) ([]ChallengeInvite, error) {
	return listPendingInvitesByCreator(ctx, db, creatorID)
}

func deleteUserInvites(ctx context.Context, db querier, userID string) (int64, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM challenge_invites WHERE creator_id = $1::uuid`,
		userID)
	if err != nil {
		return 0, fmt.Errorf("challenges: deleting user invites: %w", err)
	}
	return tag.RowsAffected(), nil
}

func hasAnyInvite(ctx context.Context, db querier, userID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM challenge_invites WHERE creator_id = $1::uuid AND status = 'pending'
		)`, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("challenges: checking invites for export: %w", err)
	}
	return exists, nil
}
