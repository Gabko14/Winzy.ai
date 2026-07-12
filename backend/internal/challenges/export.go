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

type challengeExportData struct {
	Challenges []challengeExport `json:"challenges"`
}

// exportSection matches ExportUserData in ChallengeEndpoints.cs — service
// name is the singular literal "challenge".
func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	has, err := hasAnyChallenge(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, export.ErrNoData
	}

	challenges, err := listChallengesForExport(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}

	now := s.now()
	out := make([]challengeExport, len(challenges))
	for i, c := range challenges {
		out[i] = challengeExport{
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
	return challengeExportData{Challenges: out}, nil
}
