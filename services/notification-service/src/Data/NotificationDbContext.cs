using Microsoft.EntityFrameworkCore;
using Winzy.Common.Persistence;
using Winzy.NotificationService.Entities;

namespace Winzy.NotificationService.Data;

public sealed class NotificationDbContext(DbContextOptions<NotificationDbContext> options) : BaseDbContext(options)
{
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationSettings> NotificationSettings => Set<NotificationSettings>();
    public DbSet<DeviceToken> DeviceTokens => Set<DeviceToken>();

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

        modelBuilder.Entity<DeviceToken>(b =>
        {
            b.HasIndex(t => t.UserId);

            b.Property(t => t.Platform)
                .HasMaxLength(32);

            b.Property(t => t.Token)
                .HasColumnType("text");

            b.Property(t => t.DeviceId)
                .HasMaxLength(512);

            // One token per device per user
            b.HasIndex(t => new { t.UserId, t.DeviceId })
                .IsUnique()
                .HasFilter("device_id IS NOT NULL");
        });
    }
}
