using Winzy.Common.Persistence;

namespace Winzy.HabitService.Entities;

public sealed class Habit : BaseEntity
{
    public Guid UserId { get; set; }
    public required string Name { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    public FrequencyType Frequency { get; set; } = FrequencyType.Daily;
    public List<DayOfWeek>? CustomDays { get; set; }
    public string? MinimumDescription { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }

    public ICollection<Completion> Completions { get; set; } = [];
}

public enum FrequencyType
{
    Daily,
    Weekly,
    Custom
}
