using Winzy.Common.Persistence;

namespace Winzy.NotificationService.Entities;

public sealed class Notification : BaseEntity
{
    public Guid UserId { get; set; }
    public NotificationType Type { get; set; }
    public string Data { get; set; } = "{}";
    public DateTimeOffset? ReadAt { get; set; }

    /// <summary>
    /// Unique key for idempotent notification creation. Prevents duplicates on NATS redelivery.
    /// Format: "{type}:{userId}:{event-specific-key}"
    /// </summary>
    public string? IdempotencyKey { get; set; }

    /// <summary>
    /// Tracks whether push notification was successfully delivered. Prevents duplicate pushes
    /// when NATS redelivers a message after a successful push+ack was lost.
    /// </summary>
    public bool PushDelivered { get; set; }
}
