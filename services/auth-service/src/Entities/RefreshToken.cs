using Winzy.Common.Persistence;

namespace Winzy.AuthService.Entities;

public sealed class RefreshToken : BaseEntity
{
    public Guid UserId { get; set; }
    public required string Token { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public bool IsRevoked => RevokedAt is not null;

    public User User { get; set; } = null!;
}
