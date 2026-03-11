using Microsoft.EntityFrameworkCore;
using Winzy.Common.Persistence;
using Winzy.NotificationService.Entities;

namespace Winzy.NotificationService.Data;

public sealed class NotificationDbContext(DbContextOptions<NotificationDbContext> options) : BaseDbContext(options)
{
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationSettings> NotificationSettings => Set<NotificationSettings>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Notification>(b =>
        {
            b.HasIndex(n => n.UserId);
            b.HasIndex(n => new { n.UserId, n.ReadAt });

            b.Property(n => n.Type)
                .HasConversion<string>()
                .HasMaxLength(32);

            b.Property(n => n.Data)
                .HasColumnType("jsonb");

            b.Property(n => n.ReadAt)
                .HasColumnType("timestamptz");

            b.Property(n => n.IdempotencyKey)
                .HasMaxLength(256);

            b.HasIndex(n => n.IdempotencyKey)
                .IsUnique()
                .HasFilter("idempotency_key IS NOT NULL");
        });

        modelBuilder.Entity<NotificationSettings>(b =>
        {
            b.HasIndex(s => s.UserId).IsUnique();
        });
    }
}
