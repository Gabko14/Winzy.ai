using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NATS.Client.Core;
using NATS.Client.Hosting;
using Testcontainers.Nats;
using Testcontainers.PostgreSql;
using Winzy.Common.Messaging;
using Winzy.HabitService.Data;
using Winzy.HabitService.Subscribers;
using Xunit;

namespace Winzy.HabitService.Tests;

public sealed class HabitServiceFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("habit_test_db")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    private readonly NatsContainer _nats = new NatsBuilder("nats:latest")
        .WithCommand("--jetstream")
        .Build();

    public WebApplicationFactory<Program> Factory { get; private set; } = null!;

    public string PostgresConnectionString => _postgres.GetConnectionString();
    public string NatsUrl => _nats.GetConnectionString();

    public async ValueTask InitializeAsync()
    {
        await Task.WhenAll(_postgres.StartAsync(), _nats.StartAsync());

        Factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    // Remove existing EF Core / Npgsql / migration registrations
                    var descriptorsToRemove = services
                        .Where(d =>
                            d.ServiceType.FullName?.Contains("EntityFrameworkCore") == true ||
                            d.ServiceType.FullName?.Contains("Npgsql") == true ||
                            d.ServiceType == typeof(DbContextOptions<HabitDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();

                    foreach (var descriptor in descriptorsToRemove)
                        services.Remove(descriptor);

                    // Re-register with Testcontainers PostgreSQL
                    services.AddDbContext<HabitDbContext>(options =>
                        options.UseNpgsql(PostgresConnectionString));

                    // Remove ALL NATS + subscriber registrations so we can re-add in correct order
                    // (JetStreamSetup must start before subscribers to create streams)
                    var natsDescriptors = services
                        .Where(d =>
                            d.ServiceType == typeof(INatsConnection) ||
                            d.ServiceType.FullName?.Contains("Nats", StringComparison.OrdinalIgnoreCase) == true ||
                            d.ImplementationType?.FullName?.Contains("Nats", StringComparison.OrdinalIgnoreCase) == true ||
                            d.ImplementationType == typeof(JetStreamSetup) ||
                            d.ImplementationType == typeof(NatsEventPublisher) ||
                            d.ImplementationType == typeof(UserDeletedSubscriber))
                        .ToList();

                    foreach (var descriptor in natsDescriptors)
                        services.Remove(descriptor);

                    // Re-add NATS with test container URL
                    services.AddNats(configureOpts: opts => opts with { Url = NatsUrl });
                    services.AddHostedService<JetStreamSetup>();
                    services.AddSingleton<NatsEventPublisher>();

                    // Re-add subscribers AFTER JetStreamSetup so streams exist when they start
                    services.AddHostedService<UserDeletedSubscriber>();

                    // Replace AuthService HttpClient with mock handler
                    services.AddHttpClient("AuthService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockAuthHandler());

                    // Replace SocialService HttpClient with mock handler
                    services.AddHttpClient("SocialService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockSocialHandler());
                });
            });

        // Ensure DB is created with migrations
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HabitDbContext>();
        await db.Database.MigrateAsync();
    }

    public async ValueTask DisposeAsync()
    {
        await Factory.DisposeAsync();
        await Task.WhenAll(_postgres.DisposeAsync().AsTask(), _nats.DisposeAsync().AsTask());
    }

    public HttpClient CreateAuthenticatedClient(Guid userId)
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Id", userId.ToString());
        return client;
    }

    public HabitDbContext CreateDbContext()
    {
        var scope = Factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<HabitDbContext>();
    }

    public async Task ResetDataAsync()
    {
        MockAuthHandler.Reset();
        MockSocialHandler.Reset();
        using var db = CreateDbContext();
        await db.Promises.ExecuteDeleteAsync();
        await db.Completions.ExecuteDeleteAsync();
        await db.Habits.ExecuteDeleteAsync();
    }
}

internal class MockAuthHandler : HttpMessageHandler
{
    public static readonly ConcurrentDictionary<string, Guid> UsernameToUserId = new();
    private static bool _simulateFailure;

    public static void SimulateFailure() => _simulateFailure = true;

    public static void Reset()
    {
        UsernameToUserId.Clear();
        _simulateFailure = false;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (_simulateFailure)
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));

        var path = request.RequestUri?.AbsolutePath ?? "";
        var prefix = "/auth/internal/resolve/";

        if (path.StartsWith(prefix))
        {
            var username = Uri.UnescapeDataString(path[prefix.Length..]).ToLowerInvariant();
            if (UsernameToUserId.TryGetValue(username, out var userId))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new { userId })
                });
            }
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}

internal class MockSocialHandler : HttpMessageHandler
{
    // userId -> (visibleHabitIds, excludedHabitIds, defaultVisibility)
    private static readonly ConcurrentDictionary<Guid, (List<Guid> HabitIds, List<Guid> ExcludedHabitIds, string DefaultVisibility)> _visibilityData = new();
    private static bool _simulateFailure;

    public static void SetVisibility(Guid userId, List<Guid> habitIds, string defaultVisibility = "private",
        List<Guid>? excludedHabitIds = null)
    {
        _visibilityData[userId] = (habitIds, excludedHabitIds ?? [], defaultVisibility);
    }

    public static void SimulateFailure() => _simulateFailure = true;

    public static void Reset()
    {
        _visibilityData.Clear();
        _simulateFailure = false;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (_simulateFailure)
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

        var path = request.RequestUri?.AbsolutePath ?? "";
        var prefix = "/social/internal/visible-habits/";

        if (path.StartsWith(prefix))
        {
            var userIdStr = path[prefix.Length..];
            if (Guid.TryParse(userIdStr, out var userId) && _visibilityData.TryGetValue(userId, out var data))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new
                    {
                        habitIds = data.HabitIds,
                        excludedHabitIds = data.ExcludedHabitIds,
                        defaultVisibility = data.DefaultVisibility
                    })
                });
            }

            // No visibility data configured: return empty with default=private
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new
                {
                    habitIds = Array.Empty<Guid>(),
                    excludedHabitIds = Array.Empty<Guid>(),
                    defaultVisibility = "private"
                })
            });
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}
