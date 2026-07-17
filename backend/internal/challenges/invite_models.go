package challenges

import (
	"strings"
	"time"
)

// InviteStatus is the challenge_invites.status column (lowercase wire+DB).
type InviteStatus string

const (
	InviteStatusPending InviteStatus = "pending"
	InviteStatusClaimed InviteStatus = "claimed"
	InviteStatusRevoked InviteStatus = "revoked"
	InviteStatusExpired InviteStatus = "expired"
)

const (
	maxPendingInvitesPerCreator = 20
	inviteTTLDays               = 30
	maxHabitIconLength          = 64
	minInviteTokenLength        = 20
	maxInviteTokenLength        = 64
)

// ChallengeInvite mirrors the challenge_invites table.
type ChallengeInvite struct {
	ID                string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	CreatorID         string
	Token             string
	HabitName         string
	HabitIcon         *string
	HabitFrequency    string
	HabitCustomDays   []int
	MilestoneType     MilestoneType
	TargetValue       float64
	PeriodDays        int
	RewardDescription string
	Status            InviteStatus
	ClaimedBy         *string
	ClaimedAt         *time.Time
	ExpiresAt         time.Time
}

// CreateInviteRequest is the validated create input.
type CreateInviteRequest struct {
	HabitName         string
	HabitIcon         *string
	Frequency         string
	CustomDays        []int
	MilestoneType     MilestoneType
	TargetValue       float64
	PeriodDays        int
	RewardDescription string
}

type createInviteDTO struct {
	HabitName         string             `json:"habitName"`
	HabitIcon         *string            `json:"habitIcon"`
	Frequency         string             `json:"frequency"`
	CustomDays        []int              `json:"customDays"`
	MilestoneType     milestoneTypeValue `json:"milestoneType"`
	TargetValue       float64            `json:"targetValue"`
	PeriodDays        int                `json:"periodDays"`
	RewardDescription string             `json:"rewardDescription"`
}

type createInviteResponse struct {
	ID    string `json:"id"`
	Token string `json:"token"`
	URL   string `json:"url"`
}

type inviteListItemResponse struct {
	ID                string    `json:"id"`
	Token             string    `json:"token"`
	URL               string    `json:"url"`
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

type inviteListResponse struct {
	Items []inviteListItemResponse `json:"items"`
}

type publicInviteResponse struct {
	CreatorDisplayName *string `json:"creatorDisplayName"`
	HabitName          string  `json:"habitName"`
	HabitIcon          *string `json:"habitIcon"`
	MilestoneType      string  `json:"milestoneType"`
	TargetValue        float64 `json:"targetValue"`
	PeriodDays         int     `json:"periodDays"`
	RewardDescription  string  `json:"rewardDescription"`
	Status             string  `json:"status"`
}

// EffectiveInviteStatus returns the wire status, deriving "expired" for
// pending rows past expires_at (no background job).
func EffectiveInviteStatus(inv ChallengeInvite, now time.Time) string {
	if inv.Status == InviteStatusPending && !inv.ExpiresAt.After(now) {
		return string(InviteStatusExpired)
	}
	return string(inv.Status)
}

func inviteURL(publicBaseURL, token string) string {
	return strings.TrimRight(publicBaseURL, "/") + "/ci/" + token
}

func toInviteListItem(inv ChallengeInvite, publicBaseURL string, now time.Time) inviteListItemResponse {
	days := inv.HabitCustomDays
	if days == nil {
		days = []int{}
	}
	return inviteListItemResponse{
		ID: inv.ID, Token: inv.Token, URL: inviteURL(publicBaseURL, inv.Token),
		HabitName: inv.HabitName, HabitIcon: inv.HabitIcon,
		Frequency: inv.HabitFrequency, CustomDays: days,
		MilestoneType: inv.MilestoneType.wireName(), TargetValue: inv.TargetValue,
		PeriodDays: inv.PeriodDays, RewardDescription: inv.RewardDescription,
		Status: EffectiveInviteStatus(inv, now), ExpiresAt: inv.ExpiresAt, CreatedAt: inv.CreatedAt,
	}
}
