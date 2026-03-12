using Winzy.Common.Persistence;

namespace Winzy.SocialService.Entities;

public sealed class Friendship : BaseEntity
{
    public Guid UserId { get; set; }
    public Guid FriendId { get; set; }
    public FriendshipStatus Status { get; set; } = FriendshipStatus.Pending;
}

public enum FriendshipStatus
{
    Pending,
    Accepted
}
