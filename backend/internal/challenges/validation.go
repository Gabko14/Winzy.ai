package challenges

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/Gabko14/winzy/backend/internal/habits"
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
	if habits.UTF16Len(trimmed) > maxRewardDescriptionLength {
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
