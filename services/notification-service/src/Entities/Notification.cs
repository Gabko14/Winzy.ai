using Winzy.Common.Persistence;

namespace Winzy.NotificationService.Entities;

public sealed class Notification : BaseEntity
{
    public Guid UserId { get; set; }
    public NotificationType Type { get; set; }
    public string Data { get; set; } = "{}";
    public DateTimeOffset? ReadAt { get; set; }
}
