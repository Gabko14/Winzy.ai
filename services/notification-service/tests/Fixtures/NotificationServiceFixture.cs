using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NATS.Client.Core;
using NATS.Client.Hosting;
using NATS.Client.JetStream;
using NATS.Client.Serializers.Json;
using Testcontainers.Nats;
using Testcontainers.PostgreSql;
using Winzy.Common.Messaging;
using Winzy.NotificationService.Data;
using Xunit;

namespace Winzy.NotificationService.Tests.Fixtures;

public sealed class NotificationServiceFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("notification_test_db")
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
    /// Mock handler for the SocialService HttpClient. Tests can set this to control
    /// what GET /social/internal/friends/{userId} returns.
    /// </summary>
    public MockSocialServiceHandler SocialServiceHandler { get; } = new();

    public async ValueTask InitializeAsync()
    {
        await Task.WhenAll(_postgres.StartAsync(), _nats.StartAsync());

        Factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:DefaultConnection", PostgresConnectionString);
                builder.UseSetting("Nats:Url", NatsUrl);

                builder.ConfigureServices(services =>
                {
                    // Remove the production DB registrations and re-register with test container
                    var dbDescriptors = services
                        .Where(d =>
                            d.ServiceType == typeof(DbContextOptions<NotificationDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();

                    foreach (var descriptor in dbDescriptors)
                        services.Remove(descriptor);

                    services.AddDbContext<NotificationDbContext>(options =>
                        options.UseNpgsql(PostgresConnectionString));

                    // Remove old NATS connection and re-register pointing to testcontainer
                    var natsDescriptors = services
                        .Where(d =>
                            d.ServiceType == typeof(INatsConnection) ||
                            (d.ServiceType.FullName?.Contains("NatsConnection") == true) ||
                            (d.ImplementationType?.FullName?.Contains("NatsConnection") == true))
                        .ToList();

                    foreach (var descriptor in natsDescriptors)
                        services.Remove(descriptor);

                    services.AddNats(configureOpts: opts => opts with { Url = NatsUrl });

                    // Replace SocialService HttpClient with mock handler
                    services.AddHttpClient("SocialService")
                        .ConfigurePrimaryHttpMessageHandler(() => SocialServiceHandler);
                });
            });

        // Ensure DB is created with migrations
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
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

    public NotificationDbContext CreateDbContext()
    {
        var scope = Factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
    }

    public async Task ResetDataAsync()
    {
        using var db = CreateDbContext();
        await db.Notifications.ExecuteDeleteAsync();
        await db.NotificationSettings.ExecuteDeleteAsync();
        await db.DeviceTokens.ExecuteDeleteAsync();
        SocialServiceHandler.Reset();
    }

    public async Task PublishNatsEventAsync<T>(string subject, T data)
    {
        var connection = Factory.Services.GetRequiredService<INatsConnection>();
        var js = new NatsJSContext(connection);
        var ack = await js.PublishAsync(subject, data, serializer: NatsJsonSerializer<T>.Default);
        ack.EnsureSuccess();
    }
}

/// <summary>
/// A controllable HTTP handler that simulates social-service responses.
/// Tests configure per-user friend lists; unconfigured users return an empty list.
/// </summary>
public sealed class MockSocialServiceHandler : HttpMessageHandler
{
    private readonly Dictionary<Guid, List<Guid>> _friendsMap = [];
    private bool _shouldFail;

    public void SetFriends(Guid userId, params Guid[] friendIds) =>
        _friendsMap[userId] = [.. friendIds];

    public void SetShouldFail(bool fail) => _shouldFail = fail;

    public void Reset()
    {
        _friendsMap.Clear();
        _shouldFail = false;
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (_shouldFail)
            throw new HttpRequestException("Simulated social-service failure");

        var path = request.RequestUri?.AbsolutePath ?? "";

        // Match GET /social/internal/friends/{userId}
        if (path.StartsWith("/social/internal/friends/") && request.Method == HttpMethod.Get)
        {
            var segment = path.Split('/').Last();
            if (Guid.TryParse(segment, out var userId) && _friendsMap.TryGetValue(userId, out var friends))
            {
                var json = JsonSerializer.Serialize(new { friendIds = friends });
                return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
                {
                    Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json")
                });
            }

            // User not configured — return empty friends list
            var emptyJson = JsonSerializer.Serialize(new { friendIds = Array.Empty<Guid>() });
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new StringContent(emptyJson, System.Text.Encoding.UTF8, "application/json")
            });
        }

        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.NotFound));
    }
}
