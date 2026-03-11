namespace Winzy.Common.Persistence;

/// <summary>
/// Base entity with UUID primary key and audit timestamps.
/// All service entities should inherit from this.
/// </summary>
public abstract class BaseEntity
{
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
