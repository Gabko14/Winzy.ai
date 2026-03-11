using Winzy.ChallengeService.Entities;

namespace Winzy.ChallengeService.Services;

public static class ProgressCalculator
{
    /// <summary>
    /// Calculates progress toward a challenge milestone.
    /// Returns a value between 0.0 and 1.0 representing completion fraction.
    /// </summary>
    public static double CalculateProgress(Challenge challenge, double currentConsistency)
    {
        return challenge.MilestoneType switch
        {
            MilestoneType.ConsistencyTarget => CalculateConsistencyProgress(challenge.TargetValue, currentConsistency),
            _ => 0
        };
    }

    /// <summary>
    /// Returns true if the milestone has been reached.
    /// </summary>
    public static bool IsMilestoneReached(Challenge challenge, double currentConsistency)
    {
        return challenge.MilestoneType switch
        {
            MilestoneType.ConsistencyTarget => currentConsistency >= challenge.TargetValue,
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
}
