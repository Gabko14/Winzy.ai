package challenges

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

// CreateInvite mints a pending challenge invite for creatorID.
func (s *Service) CreateInvite(ctx context.Context, creatorID string, req CreateInviteRequest) (ChallengeInvite, error) {
	if err := validateCreateInviteRequest(req); err != nil {
		return ChallengeInvite{}, err
	}

	pending, err := countPendingInvitesByCreator(ctx, s.pool, creatorID)
	if err != nil {
		return ChallengeInvite{}, err
	}
	if pending >= maxPendingInvitesPerCreator {
		return ChallengeInvite{}, newConflictError("Maximum of 20 pending invites reached")
	}

	token, err := generateInviteToken()
	if err != nil {
		return ChallengeInvite{}, err
	}

	now := s.now()
	icon := trimInviteIcon(req.HabitIcon)
	var customDays []int
	if req.Frequency == "weekly" || req.Frequency == "custom" {
		customDays = req.CustomDays
	}

	inv, err := insertInvite(ctx, s.pool, ChallengeInvite{
		CreatorID: creatorID, Token: token,
		HabitName: strings.TrimSpace(req.HabitName), HabitIcon: icon,
		HabitFrequency: req.Frequency, HabitCustomDays: customDays,
		MilestoneType: req.MilestoneType, TargetValue: req.TargetValue,
		PeriodDays: req.PeriodDays, RewardDescription: strings.TrimSpace(req.RewardDescription),
		Status: InviteStatusPending, ExpiresAt: now.AddDate(0, 0, inviteTTLDays),
	})
	if err != nil {
		return ChallengeInvite{}, err
	}

	s.logger.InfoContext(ctx, "challenge invite created",
		"invite_id", inv.ID, "creator_id", creatorID)
	return inv, nil
}

// ListInvites returns creatorID's pending invites, newest first.
func (s *Service) ListInvites(ctx context.Context, creatorID string) ([]ChallengeInvite, error) {
	return listPendingInvitesByCreator(ctx, s.pool, creatorID)
}

// RevokeInvite marks a pending invite revoked. Idempotent 204 for the
// creator whether the invite is pending (revoked), already revoked, or
// already claimed — claimed rows are left untouched (status guard).
// 404 only when the invite is missing or owned by someone else.
func (s *Service) RevokeInvite(ctx context.Context, creatorID, id string) error {
	if !isValidUUID(id) {
		return ErrNotFound
	}
	inv, found, err := findInviteByIDAndCreator(ctx, s.pool, id, creatorID)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	if inv.Status != InviteStatusPending {
		// Claimed or already revoked: no-op for the row; API stays 204.
		return nil
	}
	ok, err := revokePendingInvite(ctx, s.pool, id, creatorID, s.now())
	if err != nil {
		return err
	}
	if !ok {
		// Lost a race with claim — invite no longer pending; still 204.
		return nil
	}
	s.logger.InfoContext(ctx, "challenge invite revoked",
		"invite_id", id, "creator_id", creatorID)
	return nil
}

// ViewInvite resolves the public invite landing payload by token.
// Unknown tokens 404 after the length precheck; known tokens always return
// (including revoked/claimed) so the landing page can render kindly.
// Pending-past-expires_at reports status "expired" (computed).
func (s *Service) ViewInvite(ctx context.Context, token string) (publicInviteResponse, error) {
	if len(token) < minInviteTokenLength || len(token) > maxInviteTokenLength {
		return publicInviteResponse{}, ErrNotFound
	}

	inv, found, err := findInviteByToken(ctx, s.pool, token)
	if err != nil {
		return publicInviteResponse{}, err
	}
	if !found {
		return publicInviteResponse{}, ErrNotFound
	}

	var creatorDisplayName *string
	var creatorAvatarURL *string
	profiles := s.fetchProfiles(ctx, []string{inv.CreatorID})
	if p, ok := profiles[inv.CreatorID]; ok {
		creatorDisplayName = p.DisplayName
		creatorAvatarURL = p.AvatarURL
	}

	s.logger.InfoContext(ctx, "challenge invite viewed",
		"invite_id", inv.ID, "creator_id", inv.CreatorID)

	return publicInviteResponse{
		CreatorDisplayName: creatorDisplayName,
		CreatorAvatarURL:   creatorAvatarURL,
		HabitName:          inv.HabitName,
		HabitIcon:          inv.HabitIcon,
		MilestoneType:      inv.MilestoneType.wireName(),
		TargetValue:        inv.TargetValue,
		PeriodDays:         inv.PeriodDays,
		RewardDescription:  inv.RewardDescription,
		Status:             EffectiveInviteStatus(inv, s.now()),
	}, nil
}

// ClaimInvite materializes friendship + habit + Active challenge from a
// pending invite in ONE Postgres transaction (winzy.ai-jc38.4), threading
// the tx through social.EnsureFriendship and habits.CreateHabit via
// db.WithQuerier — the same contract DeleteAccount uses for cascades.
//
// ChallengeInviteClaimed is emitted AFTER commit as a notification-class
// event (best-effort) so the CREATOR gets the push — ChallengeCreated is
// intentionally NOT reused (its handler notifies To/recipient with
// "Someone challenged you"). FriendRequestAccepted is also suppressed:
// EnsureFriendship documents why (one push).
func (s *Service) ClaimInvite(ctx context.Context, claimerID, token string) (Challenge, error) {
	if len(token) < minInviteTokenLength || len(token) > maxInviteTokenLength {
		return Challenge{}, ErrNotFound
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Challenge{}, fmt.Errorf("challenges: beginning claim transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	txCtx := db.WithQuerier(ctx, tx)

	inv, found, err := findInviteByTokenForUpdate(txCtx, tx, token)
	if err != nil {
		return Challenge{}, err
	}
	if !found {
		return Challenge{}, ErrNotFound
	}

	// Expiry evaluated at lock-acquisition time (after FOR UPDATE returns).
	now := s.now()

	// Status/expiry before self-claim so a creator hitting their own dead
	// invite gets the 409 contract, not the self-claim 400.
	switch {
	case inv.Status == InviteStatusClaimed:
		return Challenge{}, newConflictError("This invite was already accepted")
	case inv.Status == InviteStatusRevoked:
		return Challenge{}, newConflictError("This invite is no longer active")
	case inv.Status != InviteStatusPending:
		return Challenge{}, newConflictError("This invite is no longer active")
	case !inv.ExpiresAt.After(now):
		return Challenge{}, newConflictError("This invite is no longer active")
	case inv.CreatorID == claimerID:
		return Challenge{}, newFieldError("You cannot accept your own challenge")
	}

	if err := s.social.EnsureFriendship(txCtx, inv.CreatorID, claimerID); err != nil {
		return Challenge{}, fmt.Errorf("challenges: ensuring friendship on claim: %w", err)
	}

	freq := habits.Frequency(inv.HabitFrequency)
	habit, err := s.habits.CreateHabit(txCtx, claimerID, habits.CreateHabitRequest{
		Name:       inv.HabitName,
		Icon:       inv.HabitIcon,
		Frequency:  &freq,
		CustomDays: inv.HabitCustomDays,
	})
	if err != nil {
		return Challenge{}, err
	}

	if s.claimInterrupt != nil {
		if err := s.claimInterrupt(); err != nil {
			return Challenge{}, err
		}
	}

	endsAt := now.AddDate(0, 0, inv.PeriodDays)
	challenge, err := insertChallenge(txCtx, tx, Challenge{
		HabitID: habit.ID, CreatorID: inv.CreatorID, RecipientID: claimerID,
		MilestoneType: inv.MilestoneType, TargetValue: inv.TargetValue, PeriodDays: inv.PeriodDays,
		RewardDescription: inv.RewardDescription,
		Status:            StatusActive, EndsAt: endsAt,
	})
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return Challenge{}, newConflictError("An active challenge already exists for this habit and recipient")
		}
		return Challenge{}, err
	}

	if err := markInviteClaimed(txCtx, tx, inv.ID, claimerID, now); err != nil {
		if errors.Is(err, ErrConflict) {
			return Challenge{}, newConflictError("This invite was already accepted")
		}
		return Challenge{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Challenge{}, fmt.Errorf("challenges: committing claim: %w", err)
	}

	if err := events.Emit(ctx, s.registry, events.ChallengeInviteClaimed{
		InviteID: inv.ID, ChallengeID: challenge.ID,
		CreatorID: inv.CreatorID, ClaimerID: claimerID, HabitName: inv.HabitName,
	}); err != nil {
		s.logger.ErrorContext(ctx, "challenge.invite.claimed handler failed; claim already committed",
			"challenge_id", challenge.ID, "invite_id", inv.ID, "error", err)
	}

	s.logger.InfoContext(ctx, "challenge invite claimed",
		"invite_id", inv.ID, "creator_id", inv.CreatorID, "claimer_id", claimerID,
		"challenge_id", challenge.ID, "habit_id", habit.ID)
	return challenge, nil
}

func trimInviteIcon(icon *string) *string {
	if icon == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*icon)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
