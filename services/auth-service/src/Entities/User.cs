using Winzy.Common.Persistence;

namespace Winzy.AuthService.Entities;

public sealed class User : BaseEntity
{
    public required string Email { get; set; }
    public required string Username { get; set; }
    public required string PasswordHash { get; set; }
    public string? DisplayName { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
}
