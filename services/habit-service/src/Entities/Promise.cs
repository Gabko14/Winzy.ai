using Winzy.Common.Persistence;

namespace Winzy.HabitService.Entities;

public sealed class Promise : BaseEntity
{
    public Guid UserId { get; set; }
    public Guid HabitId { get; set; }

    /// <summary>
    /// Target consistency percentage the user promises to maintain (0-100).
    /// </summary>
    public double TargetConsistency { get; set; }

    /// <summary>
    /// The date by which the promise must be kept (inclusive).
    /// </summary>
    public DateOnly EndDate { get; set; }

    /// <summary>
    /// Optional private note visible only to the owner.
    /// Never exposed on public/share surfaces.
    /// </summary>
    public string? PrivateNote { get; set; }

    public PromiseStatus Status { get; set; } = PromiseStatus.Active;

    /// <summary>
    /// When the promise was resolved (kept, ended below, or cancelled).
    /// Null while active.
    /// </summary>
    public DateTimeOffset? ResolvedAt { get; set; }

    public Habit Habit { get; set; } = null!;
}

public enum PromiseStatus
{
    Active,
    Kept,
    EndedBelow,
    Cancelled
}
