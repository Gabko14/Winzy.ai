using Winzy.Common.Persistence;

namespace Winzy.NotificationService.Entities;

public sealed class NotificationSettings : BaseEntity
{
    public Guid UserId { get; set; }
    public bool HabitReminders { get; set; } = true;
    public bool FriendActivity { get; set; } = true;
    public bool ChallengeUpdates { get; set; } = true;
}
