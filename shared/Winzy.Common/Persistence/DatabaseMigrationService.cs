using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Winzy.Common.Persistence;

/// <summary>
/// Applies pending EF Core migrations on startup.
/// Idempotent: safe to run on both clean and partially-initialized databases.
/// </summary>
public sealed class DatabaseMigrationService<TContext>(
    IServiceProvider serviceProvider,
    ILogger<DatabaseMigrationService<TContext>> logger) : IHostedService
    where TContext : DbContext
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TContext>();
        var dbName = typeof(TContext).Name;

        try
        {
            var pending = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
            if (pending.Count == 0)
            {
                logger.LogInformation("[{Context}] Database is up to date, no pending migrations", dbName);
                return;
            }

            logger.LogInformation("[{Context}] Applying {Count} pending migration(s): {Migrations}",
                dbName, pending.Count, string.Join(", ", pending));

            await db.Database.MigrateAsync(cancellationToken);

            logger.LogInformation("[{Context}] All migrations applied successfully", dbName);
        }
        catch (Exception ex)
        {
            logger.LogCritical(ex, "[{Context}] Database migration failed. Service cannot start", dbName);
            throw;
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
