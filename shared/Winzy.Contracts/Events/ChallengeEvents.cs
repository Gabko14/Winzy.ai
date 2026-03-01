namespace Winzy.Contracts.Events;

public record ChallengeCreatedEvent(Guid ChallengeId, Guid FromUserId, Guid ToUserId, Guid HabitId);

public record ChallengeCompletedEvent(Guid ChallengeId, Guid UserId, string Reward);
