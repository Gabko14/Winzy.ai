using Winzy.Common.Persistence;
using Winzy.Contracts;

namespace Winzy.HabitService.Entities;

public sealed class Completion : BaseEntity
{
    public Guid HabitId { get; set; }
    public Guid UserId { get; set; }

    /// <summary>
    /// UTC timestamp of when the completion was recorded.
    /// </summary>
    public DateTimeOffset CompletedAt { get; set; }

    /// <summary>
    /// The user's local calendar date when completion was logged.
    /// Prevents timezone drift (e.g., UTC-5 user at 10 PM not being counted as next day).
    /// </summary>
    public DateOnly LocalDate { get; set; }

    /// <summary>
    /// Whether this was a full completion or an Honest Minimum.
    /// Defaults to Full for backwards compatibility with existing data.
    /// </summary>
    public CompletionKind CompletionKind { get; set; } = CompletionKind.Full;

    public string? Note { get; set; }

    public Habit Habit { get; set; } = null!;
}
