using Winzy.ChallengeService.Entities;
using Winzy.ChallengeService.Services;

namespace Winzy.ChallengeService.Tests;

public class ProgressCalculatorTests
{
    private static Challenge MakeChallenge(
        MilestoneType milestoneType = MilestoneType.ConsistencyTarget,
        double targetValue = 80.0,
        int periodDays = 30)
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
            RewardDescription = "Test reward",
            Status = ChallengeStatus.Active,
            EndsAt = DateTimeOffset.UtcNow.AddDays(periodDays)
        };
    }

    // --- CalculateProgress ---

    [Fact]
    public void CalculateProgress_ZeroConsistency_Returns0()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.CalculateProgress(challenge, 0);

        Assert.Equal(0, result);
    }

    [Fact]
    public void CalculateProgress_HalfwayToTarget_Returns0_5()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.CalculateProgress(challenge, 40);

        Assert.Equal(0.5, result);
    }

    [Fact]
    public void CalculateProgress_AtTarget_Returns1()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.CalculateProgress(challenge, 80);

        Assert.Equal(1.0, result);
    }

    [Fact]
    public void CalculateProgress_AboveTarget_ClampedTo1()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.CalculateProgress(challenge, 100);

        Assert.Equal(1.0, result);
    }

    [Fact]
    public void CalculateProgress_ZeroTarget_Returns1()
    {
        var challenge = MakeChallenge(targetValue: 0);

        var result = ProgressCalculator.CalculateProgress(challenge, 50);

        Assert.Equal(1.0, result);
    }

    [Fact]
    public void CalculateProgress_NegativeConsistency_ClampedTo0()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.CalculateProgress(challenge, -10);

        Assert.Equal(0, result);
    }

    // --- IsMilestoneReached ---

    [Fact]
    public void IsMilestoneReached_BelowTarget_ReturnsFalse()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.IsMilestoneReached(challenge, 79.9);

        Assert.False(result);
    }

    [Fact]
    public void IsMilestoneReached_AtTarget_ReturnsTrue()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.IsMilestoneReached(challenge, 80);

        Assert.True(result);
    }

    [Fact]
    public void IsMilestoneReached_AboveTarget_ReturnsTrue()
    {
        var challenge = MakeChallenge(targetValue: 80);

        var result = ProgressCalculator.IsMilestoneReached(challenge, 100);

        Assert.True(result);
    }

    [Fact]
    public void IsMilestoneReached_ZeroTarget_ReturnsTrue()
    {
        var challenge = MakeChallenge(targetValue: 0);

        var result = ProgressCalculator.IsMilestoneReached(challenge, 0);

        Assert.True(result);
    }

    // --- Edge: exact boundary values ---

    [Theory]
    [InlineData(50, 50, true)]
    [InlineData(50, 49.99, false)]
    [InlineData(100, 100, true)]
    [InlineData(1, 0.9, false)]
    [InlineData(1, 1, true)]
    public void IsMilestoneReached_BoundaryValues(double target, double consistency, bool expected)
    {
        var challenge = MakeChallenge(targetValue: target);

        var result = ProgressCalculator.IsMilestoneReached(challenge, consistency);

        Assert.Equal(expected, result);
    }

    // --- Progress calculation precision ---

    [Theory]
    [InlineData(80, 20, 0.25)]
    [InlineData(80, 60, 0.75)]
    [InlineData(100, 33, 0.33)]
    [InlineData(50, 25, 0.5)]
    public void CalculateProgress_VariousValues(double target, double consistency, double expected)
    {
        var challenge = MakeChallenge(targetValue: target);

        var result = ProgressCalculator.CalculateProgress(challenge, consistency);

        Assert.Equal(expected, result, precision: 2);
    }
}
