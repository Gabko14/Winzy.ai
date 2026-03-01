namespace Winzy.Contracts.Events;

public record UserRegisteredEvent(Guid UserId, string Username);

public record UserDeletedEvent(Guid UserId);
