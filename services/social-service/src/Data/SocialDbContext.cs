using Microsoft.EntityFrameworkCore;
using Winzy.Common.Persistence;
using Winzy.SocialService.Entities;

namespace Winzy.SocialService.Data;

public sealed class SocialDbContext(DbContextOptions<SocialDbContext> options) : BaseDbContext(options)
{
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<VisibilitySetting> VisibilitySettings => Set<VisibilitySetting>();
    public DbSet<SocialPreference> SocialPreferences => Set<SocialPreference>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Friendship>(b =>
        {
            b.HasIndex(f => new { f.UserId, f.FriendId }).IsUnique();
            b.HasIndex(f => f.UserId);
            b.HasIndex(f => f.FriendId);

            b.Property(f => f.Status)
                .HasConversion<string>()
                .HasMaxLength(16);
        });

        modelBuilder.Entity<VisibilitySetting>(b =>
        {
            b.HasIndex(v => new { v.UserId, v.HabitId }).IsUnique();
            b.HasIndex(v => v.UserId);

            b.Property(v => v.Visibility)
                .HasConversion<string>()
                .HasMaxLength(16);
        });

        modelBuilder.Entity<SocialPreference>(b =>
        {
            b.HasIndex(p => p.UserId).IsUnique();

            b.Property(p => p.DefaultHabitVisibility)
                .HasConversion<string>()
                .HasMaxLength(16);
        });
    }
}
