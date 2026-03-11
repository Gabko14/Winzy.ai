using Microsoft.EntityFrameworkCore;

namespace Winzy.Common.Persistence;

/// <summary>
/// Base DbContext that enforces Winzy PostgreSQL conventions:
/// - snake_case table and column names
/// - UUID primary keys (auto-generated)
/// - timestamptz for all DateTime properties
/// - Automatic CreatedAt/UpdatedAt on BaseEntity derivatives
/// </summary>
public abstract class BaseDbContext(DbContextOptions options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Apply service-specific configurations first (so snake_case sees final names)
        ConfigureModel(modelBuilder);

        // Configure all BaseEntity derivatives
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (!typeof(BaseEntity).IsAssignableFrom(entityType.ClrType))
                continue;

            modelBuilder.Entity(entityType.ClrType, b =>
            {
                b.HasKey(nameof(BaseEntity.Id));

                b.Property(nameof(BaseEntity.Id))
                    .HasColumnType("uuid")
                    .HasDefaultValueSql("gen_random_uuid()");

                b.Property(nameof(BaseEntity.CreatedAt))
                    .HasColumnType("timestamptz")
                    .HasDefaultValueSql("now()");

                b.Property(nameof(BaseEntity.UpdatedAt))
                    .HasColumnType("timestamptz")
                    .HasDefaultValueSql("now()");
            });
        }

        // Apply snake_case naming last (after all configurations are applied)
        modelBuilder.ApplySnakeCaseNaming();
    }

    /// <summary>
    /// Override this to apply service-specific entity configurations.
    /// Called before snake_case naming is applied.
    /// </summary>
    protected abstract void ConfigureModel(ModelBuilder modelBuilder);

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        SetTimestamps();
        return base.SaveChangesAsync(cancellationToken);
    }

    public override int SaveChanges()
    {
        SetTimestamps();
        return base.SaveChanges();
    }

    private void SetTimestamps()
    {
        var now = DateTime.UtcNow;

        foreach (var entry in ChangeTracker.Entries<BaseEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedAt = now;
                    entry.Entity.UpdatedAt = now;
                    break;
                case EntityState.Modified:
                    entry.Entity.UpdatedAt = now;
                    break;
            }
        }
    }
}
