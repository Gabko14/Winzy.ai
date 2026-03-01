namespace Winzy.Contracts.Events;

public record HabitCreatedEvent(Guid UserId, Guid HabitId, string Name);

public record HabitCompletedEvent(Guid UserId, Guid HabitId, DateTime Date, double Consistency);
