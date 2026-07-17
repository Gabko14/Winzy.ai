package challenges

import (
	"context"
	"time"

	"github.com/Gabko14/winzy/backend/internal/export"
)

type challengeExport struct {
	ChallengeID string     `json:"challengeId"`
	FromUserID  string     `json:"fromUserId"`
	ToUserID    string     `json:"toUserId"`
	HabitID     string     `json:"habitId"`
	Reward      string     `json:"reward"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	CompletedAt *time.Time `json:"completedAt"`
}

type inviteExport struct {
	InviteID          string    `json:"inviteId"`
	HabitName         string    `json:"habitName"`
	HabitIcon         *string   `json:"habitIcon"`
	Frequency         string    `json:"frequency"`
	CustomDays        []int     `json:"customDays"`
	MilestoneType     string    `json:"milestoneType"`
	TargetValue       float64   `json:"targetValue"`
	PeriodDays        int       `json:"periodDays"`
	RewardDescription string    `json:"rewardDescription"`
	Status            string    `json:"status"`
	ExpiresAt         time.Time `json:"expiresAt"`
	CreatedAt         time.Time `json:"createdAt"`
}

type challengeExportData struct {
	Challenges []challengeExport `json:"challenges"`
	Invites    []inviteExport    `json:"invites,omitempty"`
}

// exportSection matches ExportUserData in ChallengeEndpoints.cs — service
// name is the singular literal "challenge". Pending invites are included
// when present (winzy.ai-jc38.1).
func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	hasChallenges, err := hasAnyChallenge(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	hasInvites, err := hasAnyInvite(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	if !hasChallenges && !hasInvites {
		return nil, export.ErrNoData
	}

	now := s.now()
	out := challengeExportData{Challenges: []challengeExport{}, Invites: []inviteExport{}}

	if hasChallenges {
		challenges, err := listChallengesForExport(ctx, s.pool, userID)
		if err != nil {
			return nil, err
		}
		out.Challenges = make([]challengeExport, len(challenges))
		for i, c := range challenges {
			out.Challenges[i] = challengeExport{
				ChallengeID: c.ID,
				FromUserID:  c.CreatorID,
				ToUserID:    c.RecipientID,
				HabitID:     c.HabitID,
				Reward:      c.RewardDescription,
				Status:      EffectiveStatus(c, now),
				CreatedAt:   c.CreatedAt,
				CompletedAt: c.CompletedAt,
			}
		}
	}

	if hasInvites {
		invites, err := listPendingInvitesForExport(ctx, s.pool, userID)
		if err != nil {
			return nil, err
		}
		out.Invites = make([]inviteExport, len(invites))
		for i, inv := range invites {
			days := inv.HabitCustomDays
			if days == nil {
				days = []int{}
			}
			out.Invites[i] = inviteExport{
				InviteID: inv.ID, HabitName: inv.HabitName, HabitIcon: inv.HabitIcon,
				Frequency: inv.HabitFrequency, CustomDays: days,
				MilestoneType: inv.MilestoneType.wireName(), TargetValue: inv.TargetValue,
				PeriodDays: inv.PeriodDays, RewardDescription: inv.RewardDescription,
				Status: EffectiveInviteStatus(inv, now), ExpiresAt: inv.ExpiresAt, CreatedAt: inv.CreatedAt,
			}
		}
	}

	return out, nil
}
