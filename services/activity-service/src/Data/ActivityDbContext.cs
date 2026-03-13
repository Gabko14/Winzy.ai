using Microsoft.EntityFrameworkCore;
using Winzy.ActivityService.Entities;
using Winzy.Common.Persistence;

namespace Winzy.ActivityService.Data;

public sealed class ActivityDbContext(DbContextOptions<ActivityDbContext> options) : BaseDbContext(options)
{
    public DbSet<FeedEntry> FeedEntries => Set<FeedEntry>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FeedEntry>(b =>
        {
            b.HasQueryFilter(e => e.DeletedAt == null);

            b.HasIndex(e => e.ActorId);
            b.HasIndex(e => e.CreatedAt);
            b.HasIndex(e => new { e.ActorId, e.CreatedAt });

            b.Property(e => e.EventType).HasMaxLength(64);
            b.Property(e => e.Data).HasColumnType("jsonb");

            b.Property(e => e.IdempotencyKey).HasMaxLength(256);
            b.HasIndex(e => e.IdempotencyKey)
                .IsUnique()
                .HasFilter("idempotency_key IS NOT NULL");
        });
    }
}
