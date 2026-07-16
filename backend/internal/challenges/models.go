// Package challenges ports challenge-service's experience-based challenges
// (winzy.ai-rdc7.5): friends set milestones on each other's habits and claim
// a shared reward when the milestone is reached. In the old NATS world the
// progress engine was a habit.completed subscriber; here it is a
// HabitCompleted hook handler on the shared events.Registry, and the old
// cross-service HTTP calls (social friendship check, auth batch profiles,
// habits range consistency) become direct in-process calls — see
// service.go.
package challenges

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	errInvalidMilestoneType = errors.New("challenges: invalid milestone type")
	errInvalidHabitID       = errors.New("challenges: invalid habitId")
	errInvalidRecipientID   = errors.New("challenges: invalid recipientId")
)

// ChallengeStatus mirrors Winzy.ChallengeService.Entities.ChallengeStatus.
// The DB column stores the C# PascalCase name; the wire form is lowercase
// via EffectiveStatus (which also derives Expired from EndsAt).
type ChallengeStatus string

const (
	StatusActive    ChallengeStatus = "Active"
	StatusCompleted ChallengeStatus = "Completed"
	StatusClaimed   ChallengeStatus = "Claimed"
	StatusCancelled ChallengeStatus = "Cancelled"
	StatusExpired   ChallengeStatus = "Expired"
)

// MilestoneType mirrors Winzy.ChallengeService.Entities.MilestoneType.
// DB stores PascalCase; wire JSON uses camelCase (consistencyTarget, ...).
type MilestoneType string

const (
	MilestoneConsistencyTarget    MilestoneType = "ConsistencyTarget"
	MilestoneDaysInPeriod         MilestoneType = "DaysInPeriod"
	MilestoneTotalCompletions     MilestoneType = "TotalCompletions"
	MilestoneCustomDateRange      MilestoneType = "CustomDateRange"
	MilestoneImprovementMilestone MilestoneType = "ImprovementMilestone"
)

func (m MilestoneType) wireName() string {
	s := string(m)
	if s == "" {
		return ""
	}
	return strings.ToLower(s[:1]) + s[1:]
}

func milestoneTypeFromDB(s string) MilestoneType {
	switch MilestoneType(s) {
	case MilestoneDaysInPeriod:
		return MilestoneDaysInPeriod
	case MilestoneTotalCompletions:
		return MilestoneTotalCompletions
	case MilestoneCustomDateRange:
		return MilestoneCustomDateRange
	case MilestoneImprovementMilestone:
		return MilestoneImprovementMilestone
	default:
		return MilestoneConsistencyTarget
	}
}

func challengeStatusFromDB(s string) ChallengeStatus {
	switch ChallengeStatus(s) {
	case StatusCompleted:
		return StatusCompleted
	case StatusClaimed:
		return StatusClaimed
	case StatusCancelled:
		return StatusCancelled
	case StatusExpired:
		return StatusExpired
	default:
		return StatusActive
	}
}

// Challenge mirrors the challenges table.
type Challenge struct {
	ID                       string
	CreatedAt                time.Time
	UpdatedAt                time.Time
	HabitID                  string
	CreatorID                string
	RecipientID              string
	MilestoneType            MilestoneType
	TargetValue              float64
	PeriodDays               int
	RewardDescription        string
	Status                   ChallengeStatus
	CurrentProgress          float64
	EndsAt                   time.Time
	CompletedAt              *time.Time
	ClaimedAt                *time.Time
	CompletionCount          int
	ProcessedCompletionDates *string
	CustomStartDate          *time.Time
	CustomEndDate            *time.Time
	BaselineConsistency      *float64
}

// GetProcessedDates deserializes ProcessedCompletionDates the way
// Challenge.GetProcessedDates does in Entities/Challenge.cs.
func (c *Challenge) GetProcessedDates() map[string]struct{} {
	out := map[string]struct{}{}
	if c.ProcessedCompletionDates == nil || *c.ProcessedCompletionDates == "" {
		return out
	}
	var dates []string
	if err := json.Unmarshal([]byte(*c.ProcessedCompletionDates), &dates); err != nil {
		return out
	}
	for _, d := range dates {
		out[d] = struct{}{}
	}
	return out
}

// SetProcessedDates serializes dates and updates CompletionCount the way
// Challenge.SetProcessedDates does in Entities/Challenge.cs.
func (c *Challenge) SetProcessedDates(dates map[string]struct{}) {
	list := make([]string, 0, len(dates))
	for d := range dates {
		list = append(list, d)
	}
	// Stable order is not required by C# (HashSet), but keep JSON deterministic
	// for tests/logs by sorting via a simple insertion into a sorted slice.
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if list[j] < list[i] {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	raw, _ := json.Marshal(list)
	s := string(raw)
	c.ProcessedCompletionDates = &s
	c.CompletionCount = len(dates)
}

// EffectiveStatus returns the derived lowercase status string used in every
// response and the export section — matching EffectiveStatus in
// ChallengeEndpoints.cs (Active past EndsAt becomes "expired").
func EffectiveStatus(c Challenge, now time.Time) string {
	if c.Status == StatusExpired || (c.Status == StatusActive && !c.EndsAt.After(now)) {
		return "expired"
	}
	return strings.ToLower(string(c.Status))
}

const emptyUUID = "00000000-0000-0000-0000-000000000000"

// uuidValue decodes a JSON Guid the way System.Text.Json does for non-nullable
// Guid fields: omit -> ""; explicit null/""/non-UUID -> decode error;
// all-zero UUID -> "".
type uuidValue string

func (v *uuidValue) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return errInvalidHabitID
	}
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	if s == "" {
		return errInvalidHabitID
	}
	if s == emptyUUID {
		*v = ""
		return nil
	}
	if !isValidUUID(s) {
		return errInvalidHabitID
	}
	*v = uuidValue(s)
	return nil
}

// milestoneTypeValue decodes the camelCase string names of MilestoneType
// (e.g. "consistencyTarget") used by CreateChallengeRequest.
type milestoneTypeValue MilestoneType

func (v *milestoneTypeValue) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return errInvalidMilestoneType
	}
	parsed, ok := parseMilestoneType(s)
	if !ok {
		return errInvalidMilestoneType
	}
	*v = milestoneTypeValue(parsed)
	return nil
}

func parseMilestoneType(s string) (MilestoneType, bool) {
	switch s {
	case "consistencyTarget":
		return MilestoneConsistencyTarget, true
	case "daysInPeriod":
		return MilestoneDaysInPeriod, true
	case "totalCompletions":
		return MilestoneTotalCompletions, true
	case "customDateRange":
		return MilestoneCustomDateRange, true
	case "improvementMilestone":
		return MilestoneImprovementMilestone, true
	default:
		return "", false
	}
}

func parseChallengeStatus(s string) (ChallengeStatus, bool) {
	switch strings.ToLower(s) {
	case "active":
		return StatusActive, true
	case "completed":
		return StatusCompleted, true
	case "claimed":
		return StatusClaimed, true
	case "cancelled":
		return StatusCancelled, true
	case "expired":
		return StatusExpired, true
	default:
		return "", false
	}
}

type createChallengeDTO struct {
	HabitID           uuidValue          `json:"habitId"`
	RecipientID       uuidValue          `json:"recipientId"`
	MilestoneType     milestoneTypeValue `json:"milestoneType"`
	TargetValue       float64            `json:"targetValue"`
	PeriodDays        int                `json:"periodDays"`
	RewardDescription string             `json:"rewardDescription"`
	CustomStartDate   *time.Time         `json:"customStartDate"`
	CustomEndDate     *time.Time         `json:"customEndDate"`
}

// CreateChallengeRequest is the validated create input Service.Create consumes.
type CreateChallengeRequest struct {
	HabitID           string
	RecipientID       string
	MilestoneType     MilestoneType
	TargetValue       float64
	PeriodDays        int
	RewardDescription string
	CustomStartDate   *time.Time
	CustomEndDate     *time.Time
}

type challengeResponse struct {
	ID                string     `json:"id"`
	HabitID           string     `json:"habitId"`
	CreatorID         string     `json:"creatorId"`
	RecipientID       string     `json:"recipientId"`
	MilestoneType     string     `json:"milestoneType"`
	TargetValue       float64    `json:"targetValue"`
	PeriodDays        int        `json:"periodDays"`
	RewardDescription string     `json:"rewardDescription"`
	Status            string     `json:"status"`
	CreatedAt         time.Time  `json:"createdAt"`
	EndsAt            time.Time  `json:"endsAt"`
	CompletedAt       *time.Time `json:"completedAt"`
	ClaimedAt         *time.Time `json:"claimedAt"`
}

type challengeDetailResponse struct {
	ID                  string     `json:"id"`
	HabitID             string     `json:"habitId"`
	CreatorID           string     `json:"creatorId"`
	RecipientID         string     `json:"recipientId"`
	MilestoneType       string     `json:"milestoneType"`
	TargetValue         float64    `json:"targetValue"`
	PeriodDays          int        `json:"periodDays"`
	RewardDescription   string     `json:"rewardDescription"`
	Status              string     `json:"status"`
	Progress            float64    `json:"progress"`
	CompletionCount     int        `json:"completionCount"`
	BaselineConsistency *float64   `json:"baselineConsistency"`
	CustomStartDate     *time.Time `json:"customStartDate"`
	CustomEndDate       *time.Time `json:"customEndDate"`
	CreatorDisplayName  *string    `json:"creatorDisplayName"`
	CreatedAt           time.Time  `json:"createdAt"`
	EndsAt              time.Time  `json:"endsAt"`
	CompletedAt         *time.Time `json:"completedAt"`
	ClaimedAt           *time.Time `json:"claimedAt"`
}

type listChallengesResponse struct {
	Items    []challengeDetailResponse `json:"items"`
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
	Total    int                       `json:"total"`
}

func toChallengeResponse(c Challenge, now time.Time) challengeResponse {
	return challengeResponse{
		ID: c.ID, HabitID: c.HabitID, CreatorID: c.CreatorID, RecipientID: c.RecipientID,
		MilestoneType: c.MilestoneType.wireName(), TargetValue: c.TargetValue, PeriodDays: c.PeriodDays,
		RewardDescription: c.RewardDescription, Status: EffectiveStatus(c, now),
		CreatedAt: c.CreatedAt, EndsAt: c.EndsAt, CompletedAt: c.CompletedAt, ClaimedAt: c.ClaimedAt,
	}
}

func toChallengeDetailResponse(c Challenge, now time.Time, creatorDisplayName *string) challengeDetailResponse {
	return challengeDetailResponse{
		ID: c.ID, HabitID: c.HabitID, CreatorID: c.CreatorID, RecipientID: c.RecipientID,
		MilestoneType: c.MilestoneType.wireName(), TargetValue: c.TargetValue, PeriodDays: c.PeriodDays,
		RewardDescription: c.RewardDescription, Status: EffectiveStatus(c, now),
		Progress: c.CurrentProgress, CompletionCount: c.CompletionCount,
		BaselineConsistency: c.BaselineConsistency, CustomStartDate: c.CustomStartDate,
		CustomEndDate: c.CustomEndDate, CreatorDisplayName: creatorDisplayName,
		CreatedAt: c.CreatedAt, EndsAt: c.EndsAt, CompletedAt: c.CompletedAt, ClaimedAt: c.ClaimedAt,
	}
}
