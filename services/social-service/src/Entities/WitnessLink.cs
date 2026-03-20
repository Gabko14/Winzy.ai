using Winzy.Common.Persistence;

namespace Winzy.SocialService.Entities;

public sealed class WitnessLink : BaseEntity
{
    public Guid OwnerId { get; set; }

    /// <summary>
    /// Cryptographically random 32-byte base64url token. This IS the access credential.
    /// Never log the full value — log only the link Id.
    /// </summary>
    public string Token { get; set; } = string.Empty;

    /// <summary>
    /// Private label visible only to the owner (e.g. "Maya", "Coach Sam").
    /// </summary>
    public string? Label { get; set; }

    /// <summary>
    /// Null means active. Non-null means revoked (soft delete).
    /// </summary>
    public DateTimeOffset? RevokedAt { get; set; }
}

public sealed class WitnessLinkHabit
{
    public Guid WitnessLinkId { get; set; }
    public Guid HabitId { get; set; }
}
