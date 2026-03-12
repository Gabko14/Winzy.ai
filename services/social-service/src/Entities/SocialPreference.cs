using Winzy.Common.Persistence;

namespace Winzy.SocialService.Entities;

public sealed class SocialPreference : BaseEntity
{
    public Guid UserId { get; set; }
    public HabitVisibility DefaultHabitVisibility { get; set; } = HabitVisibility.Private;
}
