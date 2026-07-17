package challenges

import (
	"fmt"
	"regexp"
	"strings"

	"unicode/utf8"
)

type fieldError struct {
	message string
}

func (e *fieldError) Error() string { return e.message }

func newFieldError(message string) error {
	return &fieldError{message: message}
}

type conflictError struct {
	msg string
}

func (e *conflictError) Error() string        { return e.msg }
func (e *conflictError) Is(target error) bool { return target == ErrConflict }

func newConflictError(msg string) error {
	return &conflictError{msg: msg}
}

// ErrUnavailable is returned when a cross-module dependency fails in a way
// the C# mapped to 503 (social friendship check HTTP failure).
var ErrUnavailable = fmt.Errorf("challenges: dependency unavailable")

var htmlTagPattern = regexp.MustCompile(`<[^>]+>`)

const maxRewardDescriptionLength = 512

func validateCreateRequest(creatorID string, req CreateChallengeRequest) error {
	if req.HabitID == "" {
		return newFieldError("HabitId is required")
	}
	if req.RecipientID == "" {
		return newFieldError("RecipientId is required")
	}
	// Self-check is third in ChallengeEndpoints.cs (L43), before reward/
	// period/milestone validation — a self+blank-reward request must return
	// "Cannot challenge yourself", not "RewardDescription is required".
	if req.RecipientID == creatorID {
		return newFieldError("Cannot challenge yourself")
	}
	if strings.TrimSpace(req.RewardDescription) == "" {
		return newFieldError("RewardDescription is required")
	}
	trimmed := strings.TrimSpace(req.RewardDescription)
	if utf8.RuneCountInString(trimmed) > maxRewardDescriptionLength {
		return newFieldError("RewardDescription must not exceed 512 characters")
	}
	if htmlTagPattern.MatchString(req.RewardDescription) {
		return newFieldError("RewardDescription must not contain HTML tags")
	}
	if req.PeriodDays <= 0 || req.PeriodDays > 365 {
		return newFieldError("PeriodDays must be between 1 and 365")
	}
	if req.MilestoneType == "" {
		return newFieldError("Invalid MilestoneType")
	}
	if err := validateTargetValue(req); err != nil {
		return err
	}
	return nil
}

func validateTargetValue(req CreateChallengeRequest) error {
	switch req.MilestoneType {
	case MilestoneConsistencyTarget:
		if req.TargetValue <= 0 || req.TargetValue > 100 {
			return newFieldError("TargetValue must be between 1 and 100")
		}
	case MilestoneDaysInPeriod:
		if req.TargetValue <= 0 || req.TargetValue > float64(req.PeriodDays) {
			return newFieldError(fmt.Sprintf("TargetValue must be between 1 and %d (PeriodDays)", req.PeriodDays))
		}
	case MilestoneTotalCompletions:
		if req.TargetValue <= 0 || req.TargetValue > 10000 {
			return newFieldError("TargetValue must be between 1 and 10000")
		}
	case MilestoneCustomDateRange:
		if req.TargetValue <= 0 || req.TargetValue > 100 {
			return newFieldError("TargetValue must be between 1 and 100")
		}
	case MilestoneImprovementMilestone:
		if req.TargetValue <= 0 || req.TargetValue > 100 {
			return newFieldError("TargetValue must be between 1 and 100")
		}
	}
	return nil
}

func validateCreateInviteRequest(req CreateInviteRequest) error {
	name := strings.TrimSpace(req.HabitName)
	if name == "" {
		return newFieldError("HabitName is required")
	}
	if utf8.RuneCountInString(name) > 256 {
		return newFieldError("HabitName must not exceed 256 characters")
	}
	if req.HabitIcon != nil {
		icon := strings.TrimSpace(*req.HabitIcon)
		if utf8.RuneCountInString(icon) > maxHabitIconLength {
			return newFieldError("HabitIcon must not exceed 64 characters")
		}
	}
	switch req.Frequency {
	case "daily", "weekly", "custom":
	default:
		return newFieldError("Invalid Frequency")
	}
	if req.Frequency == "weekly" || req.Frequency == "custom" {
		if len(req.CustomDays) == 0 {
			return newFieldError("CustomDays required for Weekly and Custom frequency")
		}
	}
	for _, d := range req.CustomDays {
		if d < 0 || d > 6 {
			return newFieldError("CustomDays must be integers between 0 and 6")
		}
	}
	if strings.TrimSpace(req.RewardDescription) == "" {
		return newFieldError("RewardDescription is required")
	}
	trimmed := strings.TrimSpace(req.RewardDescription)
	if utf8.RuneCountInString(trimmed) > maxRewardDescriptionLength {
		return newFieldError("RewardDescription must not exceed 512 characters")
	}
	if htmlTagPattern.MatchString(req.RewardDescription) {
		return newFieldError("RewardDescription must not contain HTML tags")
	}
	if req.PeriodDays <= 0 || req.PeriodDays > 365 {
		return newFieldError("PeriodDays must be between 1 and 365")
	}
	// v1 invite wizard only sends consistencyTarget.
	if req.MilestoneType != MilestoneConsistencyTarget {
		return newFieldError("Invalid MilestoneType")
	}
	if req.TargetValue <= 0 || req.TargetValue > 100 {
		return newFieldError("TargetValue must be between 1 and 100")
	}
	return nil
}
