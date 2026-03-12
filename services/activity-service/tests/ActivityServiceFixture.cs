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
using Winzy.ActivityService.Data;
using Winzy.ActivityService.Subscribers;
using Winzy.Common.Messaging;
using Xunit;

namespace Winzy.ActivityService.Tests;

[CollectionDefinition("ActivityService")]
public class ActivityServiceCollection : ICollectionFixture<ActivityServiceFixture>;

public sealed class ActivityServiceFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("activity_test_db")
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
                            d.ServiceType == typeof(DbContextOptions<ActivityDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();

                    foreach (var descriptor in descriptorsToRemove)
                        services.Remove(descriptor);

                    // Re-register with Testcontainers PostgreSQL
                    services.AddDbContext<ActivityDbContext>(options =>
                        options.UseNpgsql(PostgresConnectionString));

                    // Remove ALL NATS + subscriber registrations so we can re-add in correct order
                    var natsDescriptors = services
                        .Where(d =>
                            d.ServiceType == typeof(INatsConnection) ||
                            d.ServiceType.FullName?.Contains("Nats", StringComparison.OrdinalIgnoreCase) == true ||
                            d.ImplementationType?.FullName?.Contains("Nats", StringComparison.OrdinalIgnoreCase) == true ||
                            d.ImplementationType == typeof(JetStreamSetup) ||
                            d.ImplementationType == typeof(NatsEventPublisher) ||
                            d.ImplementationType == typeof(UserRegisteredSubscriber) ||
                            d.ImplementationType == typeof(HabitCreatedSubscriber) ||
                            d.ImplementationType == typeof(HabitCompletedSubscriber) ||
                            d.ImplementationType == typeof(FriendRequestAcceptedSubscriber) ||
                            d.ImplementationType == typeof(ChallengeCreatedSubscriber) ||
                            d.ImplementationType == typeof(ChallengeCompletedSubscriber) ||
                            d.ImplementationType == typeof(UserDeletedSubscriber))
                        .ToList();

                    foreach (var descriptor in natsDescriptors)
                        services.Remove(descriptor);

                    // Re-add NATS with test container URL
                    services.AddNats(configureOpts: opts => opts with { Url = NatsUrl });
                    services.AddHostedService<JetStreamSetup>();
                    services.AddSingleton<NatsEventPublisher>();

                    // Re-add subscribers AFTER JetStreamSetup so streams exist when they start
                    services.AddHostedService<UserRegisteredSubscriber>();
                    services.AddHostedService<HabitCreatedSubscriber>();
                    services.AddHostedService<HabitCompletedSubscriber>();
                    services.AddHostedService<FriendRequestAcceptedSubscriber>();
                    services.AddHostedService<ChallengeCreatedSubscriber>();
                    services.AddHostedService<ChallengeCompletedSubscriber>();
                    services.AddHostedService<UserDeletedSubscriber>();

                    // Replace SocialService HttpClient with mock handler
                    services.AddHttpClient("SocialService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockSocialHandler());
                });
            });

        // Ensure DB is created with migrations
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();
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

    public ActivityDbContext CreateDbContext()
    {
        var scope = Factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<ActivityDbContext>();
    }

    public NatsEventPublisher GetPublisher()
    {
        return Factory.Services.GetRequiredService<NatsEventPublisher>();
    }

    public async Task ResetDataAsync()
    {
        MockSocialHandler.FriendIds.Clear();
        MockSocialHandler.VisibleHabits.Clear();
        using var db = CreateDbContext();
        await db.FeedEntries.ExecuteDeleteAsync();
    }
}

internal class MockSocialHandler : HttpMessageHandler
{
    /// <summary>
    /// Maps userId -> list of friend IDs. Set this before running tests.
    /// </summary>
    public static readonly ConcurrentDictionary<Guid, List<Guid>> FriendIds = new();

    /// <summary>
    /// Maps "{userId}:{viewerUserId}" -> list of visible habit IDs.
    /// </summary>
    public static readonly ConcurrentDictionary<string, List<Guid>> VisibleHabits = new();

    public static void SetFriends(Guid userId, params Guid[] friends)
    {
        FriendIds[userId] = [.. friends];
    }

    public static void SetVisibleHabits(Guid userId, Guid viewerUserId, params Guid[] habitIds)
    {
        VisibleHabits[$"{userId}:{viewerUserId}"] = [.. habitIds];
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? "";
        var query = request.RequestUri?.Query ?? "";

        // Handle GET /social/internal/visible-habits/{userId}?viewer={viewerUserId}
        var visPrefix = "/social/internal/visible-habits/";
        if (path.StartsWith(visPrefix))
        {
            var userIdStr = path[visPrefix.Length..];
            var viewerParam = System.Web.HttpUtility.ParseQueryString(query)["viewer"];

            if (Guid.TryParse(userIdStr, out var userId) && Guid.TryParse(viewerParam, out var viewerUserId))
            {
                var key = $"{userId}:{viewerUserId}";
                if (VisibleHabits.TryGetValue(key, out var habitIds))
                {
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = JsonContent.Create(new { habitIds, defaultVisibility = "private" })
                    });
                }
            }

            // Default: no visible habits (private by default)
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new { habitIds = Array.Empty<Guid>(), defaultVisibility = "private" })
            });
        }

        // Handle GET /social/internal/friends/{userId}
        var friendsPrefix = "/social/internal/friends/";
        if (path.StartsWith(friendsPrefix))
        {
            var userIdStr = path[friendsPrefix.Length..];
            if (Guid.TryParse(userIdStr, out var userId) && FriendIds.TryGetValue(userId, out var friends))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new { friendIds = friends })
                });
            }
        }

        // Return empty friend list for unknown users
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = JsonContent.Create(new { friendIds = Array.Empty<Guid>() })
        });
    }
}
