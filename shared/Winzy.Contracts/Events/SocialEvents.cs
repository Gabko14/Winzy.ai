namespace Winzy.Contracts.Events;

public record FriendRequestSentEvent(Guid FromUserId, Guid ToUserId);

public record FriendRequestAcceptedEvent(Guid UserId1, Guid UserId2);

public record FriendRemovedEvent(Guid UserId1, Guid UserId2);

public record VisibilityChangedEvent(
    Guid UserId,
    Guid HabitId,
    string OldVisibility,
    string NewVisibility);
