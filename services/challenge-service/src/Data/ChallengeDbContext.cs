using Microsoft.EntityFrameworkCore;
using Winzy.ChallengeService.Entities;
using Winzy.Common.Persistence;

namespace Winzy.ChallengeService.Data;

public sealed class ChallengeDbContext(DbContextOptions<ChallengeDbContext> options) : BaseDbContext(options)
{
    public DbSet<Challenge> Challenges => Set<Challenge>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Challenge>(b =>
        {
            b.HasIndex(c => c.CreatorId);
            b.HasIndex(c => c.RecipientId);
            b.HasIndex(c => c.HabitId);
            b.HasIndex(c => new { c.RecipientId, c.Status });

            // Unique filtered index: at most one Active challenge per creator+recipient+habit.
            // Enforces duplicate prevention atomically at the DB level (winzy.ai-3e4).
            b.HasIndex(c => new { c.CreatorId, c.RecipientId, c.HabitId })
                .IsUnique()
                .HasFilter("status = 'Active'")
                .HasDatabaseName("ix_challenges_unique_active");

            b.Property(c => c.RewardDescription).HasMaxLength(512);

            b.Property(c => c.MilestoneType)
                .HasConversion<string>()
                .HasMaxLength(32);

            b.Property(c => c.Status)
                .HasConversion<string>()
                .HasMaxLength(16);

            b.Property(c => c.EndsAt).HasColumnType("timestamptz");
            b.Property(c => c.CompletedAt).HasColumnType("timestamptz");
            b.Property(c => c.ClaimedAt).HasColumnType("timestamptz");
            b.Property(c => c.CustomStartDate).HasColumnType("timestamptz");
            b.Property(c => c.CustomEndDate).HasColumnType("timestamptz");
        });
    }
}
