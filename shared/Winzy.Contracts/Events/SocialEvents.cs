namespace Winzy.Contracts.Events;

public record FriendRequestSentEvent(Guid FromUserId, Guid ToUserId);

public record FriendRequestAcceptedEvent(Guid UserId1, Guid UserId2);
