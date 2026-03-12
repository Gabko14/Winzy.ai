using Winzy.Common.Persistence;

namespace Winzy.SocialService.Entities;

public sealed class VisibilitySetting : BaseEntity
{
    public Guid UserId { get; set; }
    public Guid HabitId { get; set; }
    public HabitVisibility Visibility { get; set; } = HabitVisibility.Private;
}

public enum HabitVisibility
{
    Private,
    Friends,
    Public
}
