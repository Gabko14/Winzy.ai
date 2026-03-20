using Microsoft.EntityFrameworkCore;
using Winzy.Common.Persistence;
using Winzy.HabitService.Entities;

namespace Winzy.HabitService.Data;

public sealed class HabitDbContext(DbContextOptions<HabitDbContext> options) : BaseDbContext(options)
{
    public DbSet<Habit> Habits => Set<Habit>();
    public DbSet<Completion> Completions => Set<Completion>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Habit>(b =>
        {
            b.HasIndex(h => h.UserId);

            b.Property(h => h.Name).HasMaxLength(256);
            b.Property(h => h.Icon).HasMaxLength(64);
            b.Property(h => h.Color).HasMaxLength(32);
            b.Property(h => h.MinimumDescription).HasMaxLength(512);

            b.Property(h => h.Frequency)
                .HasConversion<string>()
                .HasMaxLength(16);

            b.Property(h => h.CustomDays)
                .HasColumnType("jsonb");

            b.Property(h => h.ArchivedAt).HasColumnType("timestamptz");
        });

        modelBuilder.Entity<Completion>(b =>
        {
            b.HasIndex(c => new { c.HabitId, c.LocalDate }).IsUnique();
            b.HasIndex(c => c.UserId);

            b.Property(c => c.CompletedAt).HasColumnType("timestamptz");
            b.Property(c => c.LocalDate).HasColumnType("date");
            b.Property(c => c.Note).HasMaxLength(512);

            b.Property(c => c.CompletionKind)
                .HasConversion<string>()
                .HasMaxLength(16)
                .HasDefaultValue(Contracts.CompletionKind.Full);

            b.HasOne(c => c.Habit)
                .WithMany(h => h.Completions)
                .HasForeignKey(c => c.HabitId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
