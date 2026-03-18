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

    /// <summary>
    /// Instance-scoped mock handler for the Social Service HTTP client.
    /// Each fixture instance owns its own state — no cross-class interference.
    /// </summary>
    public MockSocialHandler SocialHandler { get; } = new();

    /// <summary>
    /// Instance-scoped mock handler for the Habit Service HTTP client.
    /// Each fixture instance owns its own state — no cross-class interference.
    /// </summary>
    public MockHabitHandler HabitHandler { get; } = new();

    /// <summary>
    /// Instance-scoped mock handler for the Auth Service HTTP client.
    /// Serves POST /auth/internal/profiles with display name lookups.
    /// </summary>
    public MockAuthHandler AuthHandler { get; } = new();

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

                    // Replace SocialService HttpClient with instance-scoped mock handler.
                    // Each fixture owns its handler — parallel test classes don't share state.
                    services.AddHttpClient("SocialService")
                        .ConfigurePrimaryHttpMessageHandler(() => SocialHandler);

                    // Replace HabitService HttpClient with instance-scoped mock handler.
                    services.AddHttpClient("HabitService")
                        .ConfigurePrimaryHttpMessageHandler(() => HabitHandler);

                    // Replace AuthService HttpClient with instance-scoped mock handler.
                    services.AddHttpClient("AuthService")
                        .ConfigurePrimaryHttpMessageHandler(() => AuthHandler);
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
        HabitHandler.Reset();
        SocialHandler.Reset();
        AuthHandler.Reset();
    }
}

/// <summary>
/// Mock handler for Social Service HTTP calls. Instance-scoped — each fixture
/// gets its own handler so parallel test classes don't interfere with each other.
/// </summary>
public class MockSocialHandler : HttpMessageHandler
{
    /// <summary>
    /// Set of friend pairs. Key format: "{userId1}|{userId2}" (both orderings stored).
    /// </summary>
    public readonly ConcurrentDictionary<string, bool> FriendPairs = new();

    /// <summary>
    /// When set, all requests return this status code instead of normal logic.
    /// </summary>
    public HttpStatusCode? ForceStatusCode;

    /// <summary>
    /// When true, all requests throw TaskCanceledException (simulates timeout).
    /// </summary>
    public bool ForceTimeout;

    public void AddFriendship(Guid userId1, Guid userId2)
    {
        FriendPairs[$"{userId1}|{userId2}"] = true;
        FriendPairs[$"{userId2}|{userId1}"] = true;
    }

    public void Reset()
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

/// <summary>
/// Mock handler for Habit Service HTTP calls. Instance-scoped — each fixture
/// gets its own handler so parallel test classes don't interfere with each other.
/// </summary>
public class MockHabitHandler : HttpMessageHandler
{
    /// <summary>
    /// Maps habitId -> consistency value for range queries.
    /// </summary>
    public readonly ConcurrentDictionary<Guid, double> HabitConsistency = new();

    /// <summary>
    /// When set, all requests return this status code instead of normal logic.
    /// Thread-safe: read/written via Volatile to ensure cross-thread visibility.
    /// </summary>
    private int _forceStatusCode = -1; // -1 = unset

    public HttpStatusCode? ForceStatusCode
    {
        get { var v = Volatile.Read(ref _forceStatusCode); return v < 0 ? null : (HttpStatusCode)v; }
        set { Volatile.Write(ref _forceStatusCode, value.HasValue ? (int)value.Value : -1); }
    }

    /// <summary>
    /// When true, all requests throw HttpRequestException (simulates network failure).
    /// Thread-safe: read/written via Volatile to ensure cross-thread visibility.
    /// </summary>
    private int _forceFailure; // 0 = false, 1 = true

    public bool ForceFailure
    {
        get => Volatile.Read(ref _forceFailure) != 0;
        set => Volatile.Write(ref _forceFailure, value ? 1 : 0);
    }

    public void SetConsistency(Guid habitId, double consistency)
    {
        HabitConsistency[habitId] = consistency;
    }

    public void Reset()
    {
        HabitConsistency.Clear();
        ForceStatusCode = null;
        ForceFailure = false;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (ForceFailure)
            throw new HttpRequestException("Simulated habit-service failure");

        if (ForceStatusCode is { } statusCode)
            return Task.FromResult(new HttpResponseMessage(statusCode));

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

/// <summary>
/// Mock handler for Auth Service HTTP calls. Instance-scoped — each fixture
/// gets its own handler so parallel test classes don't interfere with each other.
/// Serves POST /auth/internal/profiles for batch display name lookups.
/// </summary>
public class MockAuthHandler : HttpMessageHandler
{
    /// <summary>
    /// Maps userId -> display name for batch profile lookups.
    /// </summary>
    public readonly ConcurrentDictionary<Guid, string> DisplayNames = new();

    public void SetDisplayName(Guid userId, string displayName)
    {
        DisplayNames[userId] = displayName;
    }

    public void Reset()
    {
        DisplayNames.Clear();
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? "";

        if (path == "/auth/internal/profiles" && request.Method == HttpMethod.Post)
        {
            if (request.Content is null)
                return new HttpResponseMessage(HttpStatusCode.BadRequest);

            var body = await request.Content.ReadFromJsonAsync<BatchProfilesRequest>(cancellationToken: cancellationToken);
            var userIds = body?.UserIds ?? [];

            var profiles = userIds
                .Where(id => DisplayNames.ContainsKey(id))
                .Select(id => new { userId = id, username = $"user_{id:N}", displayName = DisplayNames[id] })
                .ToList();

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(profiles)
            };
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }

    private record BatchProfilesRequest(List<Guid>? UserIds);
}
