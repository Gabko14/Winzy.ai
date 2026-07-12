package challenges

import "math"

// MilestoneContext is the event-side data ProgressCalculator needs beyond
// what's stored on the Challenge — matching Services/ProgressCalculator.cs's
// MilestoneContext record.
type MilestoneContext struct {
	Consistency float64
	EventDate   timeCivil
}

// timeCivil is YYYY-MM-DD from the habit completion's local date.
type timeCivil string

// CalculateProgress returns progress in [0,1] toward the challenge milestone
// — exact port of ProgressCalculator.CalculateProgress.
func CalculateProgress(challenge Challenge, ctx MilestoneContext) float64 {
	switch challenge.MilestoneType {
	case MilestoneConsistencyTarget:
		return calculateConsistencyProgress(challenge.TargetValue, ctx.Consistency)
	case MilestoneDaysInPeriod:
		return calculateDaysInPeriodProgress(challenge)
	case MilestoneTotalCompletions:
		return calculateTotalCompletionsProgress(challenge)
	case MilestoneCustomDateRange:
		return calculateConsistencyProgress(challenge.TargetValue, ctx.Consistency)
	case MilestoneImprovementMilestone:
		return calculateImprovementProgress(challenge, ctx.Consistency)
	default:
		return 0
	}
}

// IsMilestoneReached reports whether the milestone has been reached —
// exact port of ProgressCalculator.IsMilestoneReached.
func IsMilestoneReached(challenge Challenge, ctx MilestoneContext) bool {
	switch challenge.MilestoneType {
	case MilestoneConsistencyTarget:
		return ctx.Consistency >= challenge.TargetValue
	case MilestoneDaysInPeriod:
		return float64(challenge.CompletionCount) >= challenge.TargetValue
	case MilestoneTotalCompletions:
		return float64(challenge.CompletionCount) >= challenge.TargetValue
	case MilestoneCustomDateRange:
		return ctx.Consistency >= challenge.TargetValue
	case MilestoneImprovementMilestone:
		return calculateImprovementProgress(challenge, ctx.Consistency) >= 1.0
	default:
		return false
	}
}

func calculateConsistencyProgress(targetConsistency, currentConsistency float64) float64 {
	if targetConsistency <= 0 {
		return 1.0
	}
	return clamp01(currentConsistency / targetConsistency)
}

func calculateDaysInPeriodProgress(challenge Challenge) float64 {
	if challenge.TargetValue <= 0 {
		return 1.0
	}
	return clamp01(float64(challenge.CompletionCount) / challenge.TargetValue)
}

func calculateTotalCompletionsProgress(challenge Challenge) float64 {
	if challenge.TargetValue <= 0 {
		return 1.0
	}
	return clamp01(float64(challenge.CompletionCount) / challenge.TargetValue)
}

func calculateImprovementProgress(challenge Challenge, currentConsistency float64) float64 {
	baseline := 0.0
	if challenge.BaselineConsistency != nil {
		baseline = *challenge.BaselineConsistency
	}
	if challenge.TargetValue <= 0 {
		return 1.0
	}
	actualImprovement := currentConsistency - baseline
	if actualImprovement <= 0 {
		return 0
	}
	return clamp01(actualImprovement / challenge.TargetValue)
}

func clamp01(v float64) float64 {
	return math.Min(1, math.Max(0, v))
}
