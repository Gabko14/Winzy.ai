using Winzy.ChallengeService.Entities;
using Winzy.ChallengeService.Services;

namespace Winzy.ChallengeService.Tests;

public class ProgressCalculatorTests
{
    private static Challenge MakeChallenge(
        MilestoneType milestoneType = MilestoneType.ConsistencyTarget,
        double targetValue = 80.0,
        int periodDays = 30,
        int completionCount = 0,
        double? baselineConsistency = null)
    {
        return new Challenge
        {
            Id = Guid.NewGuid(),
            CreatorId = Guid.NewGuid(),
            RecipientId = Guid.NewGuid(),
            HabitId = Guid.NewGuid(),
            MilestoneType = milestoneType,
            TargetValue = targetValue,
            PeriodDays = periodDays,
            CompletionCount = completionCount,
            BaselineConsistency = baselineConsistency,
            RewardDescription = "Test reward",
            Status = ChallengeStatus.Active,
            EndsAt = DateTimeOffset.UtcNow.AddDays(periodDays)
        };
    }

    private static MilestoneContext Ctx(double consistency = 0, DateTime? date = null)
        => new(consistency, date ?? DateTime.UtcNow);

    // ============================================================
    // ConsistencyTarget
    // ============================================================

    [Fact]
    public void ConsistencyTarget_ZeroConsistency_Returns0()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.Equal(0, ProgressCalculator.CalculateProgress(challenge, Ctx(0)));
    }

    [Fact]
    public void ConsistencyTarget_HalfwayToTarget_Returns0_5()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.Equal(0.5, ProgressCalculator.CalculateProgress(challenge, Ctx(40)));
    }

    [Fact]
    public void ConsistencyTarget_AtTarget_Returns1()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(80)));
    }

    [Fact]
    public void ConsistencyTarget_AboveTarget_ClampedTo1()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(100)));
    }

    [Fact]
    public void ConsistencyTarget_ZeroTarget_Returns1()
    {
        var challenge = MakeChallenge(targetValue: 0);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(50)));
    }

    [Fact]
    public void ConsistencyTarget_NegativeConsistency_ClampedTo0()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.Equal(0, ProgressCalculator.CalculateProgress(challenge, Ctx(-10)));
    }

    [Fact]
    public void ConsistencyTarget_BelowTarget_NotReached()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.False(ProgressCalculator.IsMilestoneReached(challenge, Ctx(79.9)));
    }

    [Fact]
    public void ConsistencyTarget_AtTarget_Reached()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx(80)));
    }

    [Fact]
    public void ConsistencyTarget_AboveTarget_Reached()
    {
        var challenge = MakeChallenge(targetValue: 80);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx(100)));
    }

    [Theory]
    [InlineData(50, 50, true)]
    [InlineData(50, 49.99, false)]
    [InlineData(100, 100, true)]
    [InlineData(1, 0.9, false)]
    [InlineData(1, 1, true)]
    public void ConsistencyTarget_BoundaryValues(double target, double consistency, bool expected)
    {
        var challenge = MakeChallenge(targetValue: target);
        Assert.Equal(expected, ProgressCalculator.IsMilestoneReached(challenge, Ctx(consistency)));
    }

    [Theory]
    [InlineData(80, 20, 0.25)]
    [InlineData(80, 60, 0.75)]
    [InlineData(100, 33, 0.33)]
    [InlineData(50, 25, 0.5)]
    public void ConsistencyTarget_ProgressPrecision(double target, double consistency, double expected)
    {
        var challenge = MakeChallenge(targetValue: target);
        Assert.Equal(expected, ProgressCalculator.CalculateProgress(challenge, Ctx(consistency)), precision: 2);
    }

    // ============================================================
    // DaysInPeriod
    // ============================================================

    [Fact]
    public void DaysInPeriod_NoCompletions_Returns0()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 20, completionCount: 0);
        Assert.Equal(0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void DaysInPeriod_HalfwayComplete_Returns0_5()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 20, completionCount: 10);
        Assert.Equal(0.5, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void DaysInPeriod_AllComplete_Returns1()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 20, completionCount: 20);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void DaysInPeriod_OverComplete_ClampedTo1()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 20, completionCount: 25);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void DaysInPeriod_ZeroTarget_Returns1()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 0, completionCount: 0);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void DaysInPeriod_NotReached_BelowTarget()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 20, completionCount: 19);
        Assert.False(ProgressCalculator.IsMilestoneReached(challenge, Ctx()));
    }

    [Fact]
    public void DaysInPeriod_Reached_AtTarget()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 20, completionCount: 20);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx()));
    }

    [Fact]
    public void DaysInPeriod_Reached_AboveTarget()
    {
        var challenge = MakeChallenge(MilestoneType.DaysInPeriod, targetValue: 20, completionCount: 25);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx()));
    }

    // ============================================================
    // TotalCompletions
    // ============================================================

    [Fact]
    public void TotalCompletions_NoCompletions_Returns0()
    {
        var challenge = MakeChallenge(MilestoneType.TotalCompletions, targetValue: 100, completionCount: 0);
        Assert.Equal(0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void TotalCompletions_PartialProgress()
    {
        var challenge = MakeChallenge(MilestoneType.TotalCompletions, targetValue: 100, completionCount: 33);
        Assert.Equal(0.33, ProgressCalculator.CalculateProgress(challenge, Ctx()), precision: 2);
    }

    [Fact]
    public void TotalCompletions_AtTarget_Returns1()
    {
        var challenge = MakeChallenge(MilestoneType.TotalCompletions, targetValue: 100, completionCount: 100);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void TotalCompletions_AboveTarget_ClampedTo1()
    {
        var challenge = MakeChallenge(MilestoneType.TotalCompletions, targetValue: 100, completionCount: 150);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    [Fact]
    public void TotalCompletions_NotReached_BelowTarget()
    {
        var challenge = MakeChallenge(MilestoneType.TotalCompletions, targetValue: 100, completionCount: 99);
        Assert.False(ProgressCalculator.IsMilestoneReached(challenge, Ctx()));
    }

    [Fact]
    public void TotalCompletions_Reached_AtTarget()
    {
        var challenge = MakeChallenge(MilestoneType.TotalCompletions, targetValue: 100, completionCount: 100);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx()));
    }

    [Fact]
    public void TotalCompletions_ZeroTarget_Returns1()
    {
        var challenge = MakeChallenge(MilestoneType.TotalCompletions, targetValue: 0, completionCount: 0);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx()));
    }

    // ============================================================
    // CustomDateRange (uses consistency like ConsistencyTarget)
    // ============================================================

    [Fact]
    public void CustomDateRange_ZeroConsistency_Returns0()
    {
        var challenge = MakeChallenge(MilestoneType.CustomDateRange, targetValue: 90);
        Assert.Equal(0, ProgressCalculator.CalculateProgress(challenge, Ctx(0)));
    }

    [Fact]
    public void CustomDateRange_AtTarget_Returns1()
    {
        var challenge = MakeChallenge(MilestoneType.CustomDateRange, targetValue: 90);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(90)));
    }

    [Fact]
    public void CustomDateRange_Reached()
    {
        var challenge = MakeChallenge(MilestoneType.CustomDateRange, targetValue: 90);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx(90)));
    }

    [Fact]
    public void CustomDateRange_NotReached()
    {
        var challenge = MakeChallenge(MilestoneType.CustomDateRange, targetValue: 90);
        Assert.False(ProgressCalculator.IsMilestoneReached(challenge, Ctx(89)));
    }

    // ============================================================
    // ImprovementMilestone
    // ============================================================

    [Fact]
    public void Improvement_NoImprovement_Returns0()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.Equal(0, ProgressCalculator.CalculateProgress(challenge, Ctx(50)));
    }

    [Fact]
    public void Improvement_HalfwayProgress()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.Equal(0.5, ProgressCalculator.CalculateProgress(challenge, Ctx(60)));
    }

    [Fact]
    public void Improvement_AtTarget_Returns1()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(70)));
    }

    [Fact]
    public void Improvement_AboveTarget_ClampedTo1()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(80)));
    }

    [Fact]
    public void Improvement_Decline_Returns0()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.Equal(0, ProgressCalculator.CalculateProgress(challenge, Ctx(40)));
    }

    [Fact]
    public void Improvement_NullBaseline_TreatsAs0()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: null);
        // baseline = 0, current = 20, target improvement = 20 => progress = 1.0
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(20)));
    }

    [Fact]
    public void Improvement_ZeroTarget_Returns1()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 0, baselineConsistency: 50);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(50)));
    }

    [Fact]
    public void Improvement_Reached_AtTarget()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx(70)));
    }

    [Fact]
    public void Improvement_NotReached_BelowTarget()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.False(ProgressCalculator.IsMilestoneReached(challenge, Ctx(69)));
    }

    [Fact]
    public void Improvement_Reached_AboveTarget()
    {
        var challenge = MakeChallenge(MilestoneType.ImprovementMilestone, targetValue: 20, baselineConsistency: 50);
        Assert.True(ProgressCalculator.IsMilestoneReached(challenge, Ctx(80)));
    }

    // ============================================================
    // Edge cases across types
    // ============================================================

    [Theory]
    [InlineData(MilestoneType.ConsistencyTarget)]
    [InlineData(MilestoneType.DaysInPeriod)]
    [InlineData(MilestoneType.TotalCompletions)]
    [InlineData(MilestoneType.CustomDateRange)]
    [InlineData(MilestoneType.ImprovementMilestone)]
    public void AllTypes_ZeroTarget_Returns1(MilestoneType type)
    {
        var challenge = MakeChallenge(type, targetValue: 0, baselineConsistency: 0);
        Assert.Equal(1.0, ProgressCalculator.CalculateProgress(challenge, Ctx(0)));
    }
}
