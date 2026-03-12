using Winzy.Common.Persistence;

namespace Winzy.NotificationService.Entities;

public sealed class DeviceToken : BaseEntity
{
    public Guid UserId { get; set; }

    /// <summary>
    /// "web_push" or "expo_push" — distinguishes the delivery path.
    /// </summary>
    public string Platform { get; set; } = string.Empty;

    /// <summary>
    /// For web push: the full PushSubscription JSON (endpoint + keys).
    /// For expo push: the Expo push token string.
    /// </summary>
    public string Token { get; set; } = string.Empty;

    /// <summary>
    /// Optional device/browser identifier for deduplication.
    /// Web: derived from subscription endpoint. Native: Expo installation ID.
    /// </summary>
    public string? DeviceId { get; set; }
}
