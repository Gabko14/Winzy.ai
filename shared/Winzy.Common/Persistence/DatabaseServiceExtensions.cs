using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Winzy.Common.Persistence;

public static class DatabaseServiceExtensions
{
    /// <summary>
    /// Registers a service's DbContext with Npgsql using the "DefaultConnection" connection string,
    /// and adds a hosted service that applies pending migrations on startup.
    /// </summary>
    public static IServiceCollection AddServiceDatabase<TContext>(
        this IServiceCollection services,
        IConfiguration config)
        where TContext : BaseDbContext
    {
        var connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "Missing ConnectionStrings:DefaultConnection. " +
                "Set it in appsettings.json or via environment variable ConnectionStrings__DefaultConnection.");

        services.AddDbContext<TContext>(options =>
            options.UseNpgsql(connectionString));

        services.AddHostedService<DatabaseMigrationService<TContext>>();

        return services;
    }
}
