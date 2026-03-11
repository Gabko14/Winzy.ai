using Microsoft.EntityFrameworkCore;
using Winzy.AuthService.Entities;
using Winzy.Common.Persistence;

namespace Winzy.AuthService.Data;

public sealed class AuthDbContext(DbContextOptions<AuthDbContext> options) : BaseDbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void ConfigureModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(b =>
        {
            b.HasIndex(u => u.Email).IsUnique();
            b.HasIndex(u => u.Username).IsUnique();

            b.Property(u => u.Email).HasMaxLength(256);
            b.Property(u => u.Username).HasMaxLength(64);
            b.Property(u => u.PasswordHash).HasMaxLength(512);
            b.Property(u => u.DisplayName).HasMaxLength(128);

            b.Property(u => u.LastLoginAt).HasColumnType("timestamptz");
        });

        modelBuilder.Entity<RefreshToken>(b =>
        {
            b.HasIndex(t => t.Token).IsUnique();
            b.HasIndex(t => t.UserId);

            b.Property(t => t.Token).HasMaxLength(512);
            b.Property(t => t.ExpiresAt).HasColumnType("timestamptz");
            b.Property(t => t.RevokedAt).HasColumnType("timestamptz");

            b.HasOne(t => t.User)
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
