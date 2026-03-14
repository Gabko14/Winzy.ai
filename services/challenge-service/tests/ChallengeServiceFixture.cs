using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NATS.Client.Core;
using NATS.Client.Hosting;
using Testcontainers.Nats;
using Testcontainers.PostgreSql;
using Winzy.ChallengeService.Data;
using Winzy.ChallengeService.Subscribers;
using Winzy.Common.Messaging;
using Xunit;

namespace Winzy.ChallengeService.Tests;

public sealed class ChallengeServiceFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("challenge_test_db")
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

        // Wait for NATS to be fully ready (not just port-open).
        // Testcontainers considers the container started when the port is reachable,
        // but JetStream may not be initialized yet — causes flaky failures on CI.
        await WaitForNatsReadyAsync();

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
                            d.ServiceType == typeof(DbContextOptions<ChallengeDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();

                    foreach (var descriptor in descriptorsToRemove)
                        services.Remove(descriptor);

                    // Re-register with Testcontainers PostgreSQL
                    services.AddDbContext<ChallengeDbContext>(options =>
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
                            d.ImplementationType == typeof(HabitCompletedSubscriber) ||
                            d.ImplementationType == typeof(UserDeletedSubscriber))
                        .ToList();

                    foreach (var descriptor in natsDescriptors)
                        services.Remove(descriptor);

                    // Re-add NATS with test container URL
                    services.AddNats(configureOpts: opts => opts with { Url = NatsUrl });
                    services.AddHostedService<JetStreamSetup>();
                    services.AddSingleton<NatsEventPublisher>();

                    // Re-add subscribers AFTER JetStreamSetup so streams exist when they start
                    services.AddHostedService<HabitCompletedSubscriber>();
                    services.AddHostedService<UserDeletedSubscriber>();

                    // Replace SocialService HttpClient with mock handler
                    services.AddHttpClient("SocialService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockSocialHandler());

                    // Replace HabitService HttpClient with mock handler
                    services.AddHttpClient("HabitService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockHabitHandler());
                });
            });

        // Ensure DB is created with migrations
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChallengeDbContext>();
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

    public ChallengeDbContext CreateDbContext()
    {
        var scope = Factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<ChallengeDbContext>();
    }

    public NatsEventPublisher GetPublisher()
    {
        return Factory.Services.GetRequiredService<NatsEventPublisher>();
    }

    private async Task WaitForNatsReadyAsync()
    {
        const int maxAttempts = 20;
        const int delayMs = 250;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                await using var conn = new NatsConnection(new NatsOpts { Url = NatsUrl });
                await conn.ConnectAsync();
                await conn.PingAsync();
                return;
            }
            catch
            {
                if (attempt == maxAttempts)
                    throw new InvalidOperationException(
                        $"NATS container not ready after {maxAttempts * delayMs}ms at {NatsUrl}");
                await Task.Delay(delayMs);
            }
        }
    }

    public async Task ResetDataAsync()
    {
        using var db = CreateDbContext();
        await db.Challenges.ExecuteDeleteAsync();
        MockHabitHandler.HabitConsistency.Clear();
        MockSocialHandler.Reset();
    }
}

internal class MockSocialHandler : HttpMessageHandler
{
    /// <summary>
    /// Set of friend pairs. Key format: "{userId1}|{userId2}" (both orderings stored).
    /// </summary>
    public static readonly ConcurrentDictionary<string, bool> FriendPairs = new();

    /// <summary>
    /// When set, all requests return this status code instead of normal logic.
    /// </summary>
    public static HttpStatusCode? ForceStatusCode;

    /// <summary>
    /// When true, all requests throw TaskCanceledException (simulates timeout).
    /// </summary>
    public static bool ForceTimeout;

    public static void AddFriendship(Guid userId1, Guid userId2)
    {
        FriendPairs[$"{userId1}|{userId2}"] = true;
        FriendPairs[$"{userId2}|{userId1}"] = true;
    }

    public static void Reset()
    {
        FriendPairs.Clear();
        ForceStatusCode = null;
        ForceTimeout = false;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (ForceTimeout)
            throw new TaskCanceledException("The request was canceled due to the configured timeout.");

        if (ForceStatusCode is { } statusCode)
            return Task.FromResult(new HttpResponseMessage(statusCode));

        var path = request.RequestUri?.AbsolutePath ?? "";
        var prefix = "/social/internal/friends/";

        if (path.StartsWith(prefix))
        {
            var remainder = path[prefix.Length..];
            var parts = remainder.Split('/');
            if (parts.Length == 2)
            {
                var key = $"{parts[0]}|{parts[1]}";
                if (FriendPairs.ContainsKey(key))
                {
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = JsonContent.Create(new { areFriends = true })
                    });
                }
            }
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}

internal class MockHabitHandler : HttpMessageHandler
{
    /// <summary>
    /// Maps habitId -> consistency value for range queries.
    /// </summary>
    public static readonly ConcurrentDictionary<Guid, double> HabitConsistency = new();

    public static void SetConsistency(Guid habitId, double consistency)
    {
        HabitConsistency[habitId] = consistency;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? "";
        var prefix = "/habits/internal/";

        if (path.StartsWith(prefix) && path.Contains("/consistency"))
        {
            // Extract habitId from /habits/internal/{habitId}/consistency
            var afterPrefix = path[prefix.Length..];
            var habitIdStr = afterPrefix[..afterPrefix.IndexOf('/')];
            if (Guid.TryParse(habitIdStr, out var habitId) && HabitConsistency.TryGetValue(habitId, out var consistency))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new { habitId, consistency })
                });
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}
