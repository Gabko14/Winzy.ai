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
using Winzy.SocialService.Data;
using Winzy.SocialService.Subscribers;
using Xunit;

namespace Winzy.SocialService.Tests;

public sealed class SocialServiceFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("social_test_db")
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
                            d.ServiceType == typeof(DbContextOptions<SocialDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();

                    foreach (var descriptor in descriptorsToRemove)
                        services.Remove(descriptor);

                    // Re-register with Testcontainers PostgreSQL
                    services.AddDbContext<SocialDbContext>(options =>
                        options.UseNpgsql(PostgresConnectionString));

                    // Remove ALL NATS + subscriber registrations
                    var natsDescriptors = services
                        .Where(d =>
                            d.ServiceType == typeof(INatsConnection) ||
                            d.ServiceType.FullName?.Contains("Nats", StringComparison.OrdinalIgnoreCase) == true ||
                            d.ImplementationType?.FullName?.Contains("Nats", StringComparison.OrdinalIgnoreCase) == true ||
                            d.ImplementationType == typeof(JetStreamSetup) ||
                            d.ImplementationType == typeof(NatsEventPublisher) ||
                            d.ImplementationType == typeof(UserDeletedSubscriber) ||
                            d.ImplementationType == typeof(HabitCreatedSubscriber) ||
                            d.ImplementationType == typeof(HabitArchivedSubscriber))
                        .ToList();

                    foreach (var descriptor in natsDescriptors)
                        services.Remove(descriptor);

                    // Re-add NATS with test container URL
                    services.AddNats(configureOpts: opts => opts with { Url = NatsUrl });
                    services.AddHostedService<JetStreamSetup>();
                    services.AddSingleton<NatsEventPublisher>();
                    services.AddHostedService<UserDeletedSubscriber>();
                    services.AddHostedService<HabitCreatedSubscriber>();
                    services.AddHostedService<HabitArchivedSubscriber>();

                    // Replace HabitService and AuthService HttpClients with mock handlers
                    services.AddHttpClient("HabitService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockHabitHandler());
                    services.AddHttpClient("AuthService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockAuthHandler());
                });
            });

        // Ensure DB is created with migrations
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SocialDbContext>();
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

    public SocialDbContext CreateDbContext()
    {
        var scope = Factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<SocialDbContext>();
    }

    public async Task ResetDataAsync()
    {
        MockHabitHandler.HabitResponses.Clear();
        MockAuthHandler.ProfileResponses.Clear();
        using var db = CreateDbContext();
        await db.VisibilitySettings.ExecuteDeleteAsync();
        await db.SocialPreferences.ExecuteDeleteAsync();
        await db.Friendships.ExecuteDeleteAsync();
    }
}

internal class MockHabitHandler : HttpMessageHandler
{
    /// <summary>
    /// Map of userId -> JSON response for GET /habits/user/{userId}
    /// </summary>
    public static readonly ConcurrentDictionary<Guid, string> HabitResponses = new();

    public static void SetHabits(Guid userId, object[] habits)
    {
        HabitResponses[userId] = System.Text.Json.JsonSerializer.Serialize(habits,
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? "";
        var prefix = "/habits/user/";

        if (path.StartsWith(prefix))
        {
            var userIdStr = path[prefix.Length..].TrimEnd('/');
            if (Guid.TryParse(userIdStr, out var userId) && HabitResponses.TryGetValue(userId, out var json))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json")
                });
            }
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}

internal class MockAuthHandler : HttpMessageHandler
{
    /// <summary>
    /// Map of userId -> profile data for POST /auth/internal/profiles
    /// </summary>
    public static readonly ConcurrentDictionary<Guid, (string Username, string? DisplayName)> ProfileResponses = new();

    public static void SetProfile(Guid userId, string username, string? displayName = null)
    {
        ProfileResponses[userId] = (username, displayName);
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? "";

        if (path == "/auth/internal/profiles" && request.Method == HttpMethod.Post)
        {
            var body = await request.Content!.ReadFromJsonAsync<BatchProfilesRequestDto>(cancellationToken: cancellationToken);
            var ids = body?.UserIds ?? [];

            var profiles = ids
                .Where(id => ProfileResponses.ContainsKey(id))
                .Select(id =>
                {
                    var (username, displayName) = ProfileResponses[id];
                    return new { userId = id, username, displayName };
                })
                .ToList();

            var json = System.Text.Json.JsonSerializer.Serialize(profiles,
                new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json")
            };
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }

    private record BatchProfilesRequestDto(List<Guid>? UserIds);
}
