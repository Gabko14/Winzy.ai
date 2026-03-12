using Winzy.Common.Persistence;

namespace Winzy.ChallengeService.Entities;

public sealed class Challenge : BaseEntity
{
    public Guid HabitId { get; set; }
    public Guid CreatorId { get; set; }
    public Guid RecipientId { get; set; }
    public MilestoneType MilestoneType { get; set; }
    public double TargetValue { get; set; }
    public int PeriodDays { get; set; }
    public required string RewardDescription { get; set; }
    public ChallengeStatus Status { get; set; } = ChallengeStatus.Active;
    public double CurrentProgress { get; set; }
    public DateTimeOffset EndsAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? ClaimedAt { get; set; }

    // DaysInPeriod / TotalCompletions: tracks how many completions have been recorded
    public int CompletionCount { get; set; }

    // CustomDateRange: the active window for the challenge
    public DateTimeOffset? CustomStartDate { get; set; }
    public DateTimeOffset? CustomEndDate { get; set; }

    // ImprovementMilestone: the consistency when the challenge started
    public double? BaselineConsistency { get; set; }
}

public enum ChallengeStatus
{
    Active,
    Completed,
    Claimed,
    Cancelled,
    Expired
}

public enum MilestoneType
{
    ConsistencyTarget,
    DaysInPeriod,
    TotalCompletions,
    CustomDateRange,
    ImprovementMilestone
}
