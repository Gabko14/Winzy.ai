using System.Text.Json;
using Winzy.Common.Persistence;

namespace Winzy.ActivityService.Entities;

public sealed class FeedEntry : BaseEntity
{
    public Guid ActorId { get; set; }
    public string? ActorUsername { get; set; }
    public string? ActorDisplayName { get; set; }
    public required string EventType { get; set; }
    public JsonDocument? Data { get; set; }

    /// <summary>
    /// Unique key for idempotent feed entry creation. Prevents duplicates on NATS redelivery.
    /// Format: "{eventType}:{actorId}:{event-specific-key}"
    /// </summary>
    public string? IdempotencyKey { get; set; }

    /// <summary>
    /// Soft-delete timestamp. Set when privacy changes invalidate the entry
    /// (e.g. visibility narrowed, friend removed). Null means active.
    /// </summary>
    public DateTimeOffset? DeletedAt { get; set; }
}
