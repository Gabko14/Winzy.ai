namespace Winzy.Contracts.Events;

public record HabitCreatedEvent(Guid UserId, Guid HabitId, string Name);

public record HabitCompletedEvent(Guid UserId, Guid HabitId, DateTime Date, double Consistency, string? Timezone = null, string? DisplayName = null, string? HabitName = null);

public record HabitArchivedEvent(Guid UserId, Guid HabitId);
