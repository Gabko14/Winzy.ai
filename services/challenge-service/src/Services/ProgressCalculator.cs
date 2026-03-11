using Winzy.ChallengeService.Entities;

namespace Winzy.ChallengeService.Services;

/// <summary>
/// Context passed from the event handler containing data beyond what's stored on the Challenge entity.
/// </summary>
public record MilestoneContext(double Consistency, DateTime EventDate);

public static class ProgressCalculator
{
    /// <summary>
    /// Calculates progress toward a challenge milestone.
    /// Returns a value between 0.0 and 1.0 representing completion fraction.
    /// </summary>
    public static double CalculateProgress(Challenge challenge, MilestoneContext ctx)
    {
        return challenge.MilestoneType switch
        {
            MilestoneType.ConsistencyTarget => CalculateConsistencyProgress(challenge.TargetValue, ctx.Consistency),
            MilestoneType.DaysInPeriod => CalculateDaysInPeriodProgress(challenge),
            MilestoneType.TotalCompletions => CalculateTotalCompletionsProgress(challenge),
            MilestoneType.CustomDateRange => CalculateConsistencyProgress(challenge.TargetValue, ctx.Consistency),
            MilestoneType.ImprovementMilestone => CalculateImprovementProgress(challenge, ctx.Consistency),
            _ => 0
        };
    }

    /// <summary>
    /// Returns true if the milestone has been reached.
    /// </summary>
    public static bool IsMilestoneReached(Challenge challenge, MilestoneContext ctx)
    {
        return challenge.MilestoneType switch
        {
            MilestoneType.ConsistencyTarget => ctx.Consistency >= challenge.TargetValue,
            MilestoneType.DaysInPeriod => challenge.CompletionCount >= challenge.TargetValue,
            MilestoneType.TotalCompletions => challenge.CompletionCount >= challenge.TargetValue,
            MilestoneType.CustomDateRange => ctx.Consistency >= challenge.TargetValue,
            MilestoneType.ImprovementMilestone => CalculateImprovementProgress(challenge, ctx.Consistency) >= 1.0,
            _ => false
        };
    }

    private static double CalculateConsistencyProgress(double targetConsistency, double currentConsistency)
    {
        if (targetConsistency <= 0)
            return 1.0;

        var progress = currentConsistency / targetConsistency;
        return Math.Clamp(progress, 0, 1);
    }

    private static double CalculateDaysInPeriodProgress(Challenge challenge)
    {
        if (challenge.TargetValue <= 0)
            return 1.0;

        var progress = challenge.CompletionCount / challenge.TargetValue;
        return Math.Clamp(progress, 0, 1);
    }

    private static double CalculateTotalCompletionsProgress(Challenge challenge)
    {
        if (challenge.TargetValue <= 0)
            return 1.0;

        var progress = challenge.CompletionCount / challenge.TargetValue;
        return Math.Clamp(progress, 0, 1);
    }

    private static double CalculateImprovementProgress(Challenge challenge, double currentConsistency)
    {
        var baseline = challenge.BaselineConsistency ?? 0;
        if (challenge.TargetValue <= 0)
            return 1.0;

        var actualImprovement = currentConsistency - baseline;
        if (actualImprovement <= 0)
            return 0;

        var progress = actualImprovement / challenge.TargetValue;
        return Math.Clamp(progress, 0, 1);
    }
}
