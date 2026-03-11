using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.Nats;
using Testcontainers.PostgreSql;
using Winzy.AuthService.Data;
using Xunit;

namespace Winzy.AuthService.Tests.Fixtures;

public sealed class AuthServiceFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("auth_test_db")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    private readonly NatsContainer _nats = new NatsBuilder("nats:latest")
        .WithCommand("--jetstream")
        .Build();

    public string PostgresConnectionString => _postgres.GetConnectionString();
    public string NatsUrl => _nats.GetConnectionString();

    public WebApplicationFactory<Program> CreateFactory()
    {
        return new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    // Remove existing DB registrations
                    var efDescriptors = services
                        .Where(d =>
                            d.ServiceType.FullName?.Contains("EntityFrameworkCore") == true ||
                            d.ServiceType.FullName?.Contains("Npgsql") == true ||
                            d.ServiceType == typeof(DbContextOptions<AuthDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();

                    foreach (var descriptor in efDescriptors)
                        services.Remove(descriptor);

                    services.AddDbContext<AuthDbContext>(options =>
                        options.UseNpgsql(PostgresConnectionString));
                });

                builder.UseSetting("Nats:Url", NatsUrl);
                builder.UseSetting("Jwt:Secret", "test-secret-key-that-is-at-least-32-characters-long!!");
                builder.UseSetting("Jwt:AccessTokenMinutes", "15");
                builder.UseSetting("Jwt:RefreshTokenDays", "7");
            });
    }

    public async Task MigrateDatabase()
    {
        var factory = CreateFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
        await db.Database.MigrateAsync();
        await factory.DisposeAsync();
    }

    public async ValueTask InitializeAsync()
    {
        await Task.WhenAll(
            _postgres.StartAsync(),
            _nats.StartAsync());

        await MigrateDatabase();
    }

    public async ValueTask DisposeAsync()
    {
        await Task.WhenAll(
            _postgres.DisposeAsync().AsTask(),
            _nats.DisposeAsync().AsTask());
    }
}
