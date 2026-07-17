package challenges

import (
	"context"
	"strings"
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

// RevokeInvite marks the invite revoked. Idempotent for already-revoked;
// 404 when the invite is missing or owned by someone else.
func (s *Service) RevokeInvite(ctx context.Context, creatorID, id string) error {
	if !isValidUUID(id) {
		return ErrNotFound
	}
	ok, err := revokeInvite(ctx, s.pool, id, creatorID, s.now())
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
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
	names := s.fetchDisplayNames(ctx, []string{inv.CreatorID})
	if name, ok := names[inv.CreatorID]; ok {
		creatorDisplayName = name
	}

	s.logger.InfoContext(ctx, "challenge invite viewed",
		"invite_id", inv.ID, "creator_id", inv.CreatorID)

	return publicInviteResponse{
		CreatorDisplayName: creatorDisplayName,
		HabitName:          inv.HabitName,
		HabitIcon:          inv.HabitIcon,
		MilestoneType:      inv.MilestoneType.wireName(),
		TargetValue:        inv.TargetValue,
		PeriodDays:         inv.PeriodDays,
		RewardDescription:  inv.RewardDescription,
		Status:             EffectiveInviteStatus(inv, s.now()),
	}, nil
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
