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
        });
    }
}
