using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NATS.Client.Core;
using NATS.Client.Hosting;
using Testcontainers.Nats;
using Testcontainers.PostgreSql;
using Winzy.ChallengeService.Data;
using Winzy.ChallengeService.Subscribers;
using Winzy.Common.Messaging;
using Xunit;

namespace Winzy.ChallengeService.Tests;

/// <summary>
/// Contract tests that verify the Challenge Service's friendship check against
/// a handler implementing the documented Social Service contract, proving that
/// route shape, status codes, and response format match expectations.
///
/// Unlike the existing mock-based tests (which verify happy/sad paths with an in-memory mock),
/// these tests use a contract-aware handler that replicates the real Social Service's exact
/// behavior for GET /social/internal/friends/{userId1}/{userId2}:
///   - 200 { areFriends: true } when an accepted friendship exists
///   - 404 when no accepted friendship exists (including pending friendships)
///   - 404 when GUIDs are malformed (route constraint rejects them)
///
/// This catches route drift, status code drift, and response shape drift between services.
/// </summary>
public sealed class FriendshipContractFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("challenge_contract_db")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    private readonly NatsContainer _nats = new NatsBuilder("nats:latest")
        .WithCommand("--jetstream")
        .Build();

    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    internal SocialContractHandler ContractHandler { get; } = new();

    public async ValueTask InitializeAsync()
    {
        await Task.WhenAll(_postgres.StartAsync(), _nats.StartAsync());

        Factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    var descriptorsToRemove = services
                        .Where(d =>
                            d.ServiceType.FullName?.Contains("EntityFrameworkCore") == true ||
                            d.ServiceType.FullName?.Contains("Npgsql") == true ||
                            d.ServiceType == typeof(DbContextOptions<ChallengeDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();
                    foreach (var descriptor in descriptorsToRemove)
                        services.Remove(descriptor);

                    services.AddDbContext<ChallengeDbContext>(options =>
                        options.UseNpgsql(_postgres.GetConnectionString()));

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

                    // Re-add NATS connection and publisher (needed for DI) but NOT subscribers.
                    // Subscribers are not needed for HTTP endpoint contract tests.
                    services.AddNats(configureOpts: opts => opts with { Url = _nats.GetConnectionString() });
                    services.AddHostedService<JetStreamSetup>();
                    services.AddSingleton<NatsEventPublisher>();

                    // Wire SocialService client to the contract handler
                    services.AddHttpClient("SocialService")
                        .ConfigurePrimaryHttpMessageHandler(() => ContractHandler);

                    services.AddHttpClient("HabitService")
                        .ConfigurePrimaryHttpMessageHandler(() => new MockHabitHandler());
                });
            });

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

    public async Task ResetDataAsync()
    {
        ContractHandler.Reset();
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChallengeDbContext>();
        await db.Challenges.ExecuteDeleteAsync();
    }
}

/// <summary>
/// Handler that implements the Social Service's internal friendship endpoint contract.
/// Unlike the simple MockSocialHandler, this replicates the exact route parsing and
/// response format of GET /social/internal/friends/{userId1:guid}/{userId2:guid},
/// including route constraint behavior (invalid GUIDs return 404, not 400).
/// </summary>
internal class SocialContractHandler : HttpMessageHandler
{
    private readonly HashSet<string> _acceptedFriendships = new();
    private readonly HashSet<string> _pendingFriendships = new();

    public int RequestCount { get; private set; }
    public List<string> RequestPaths { get; } = new();

    public void AddAcceptedFriendship(Guid userId1, Guid userId2)
    {
        _acceptedFriendships.Add($"{userId1}|{userId2}");
        _acceptedFriendships.Add($"{userId2}|{userId1}");
    }

    public void AddPendingFriendship(Guid userId1, Guid userId2)
    {
        _pendingFriendships.Add($"{userId1}|{userId2}");
    }

    public void Reset()
    {
        _acceptedFriendships.Clear();
        _pendingFriendships.Clear();
        RequestPaths.Clear();
        RequestCount = 0;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestCount++;
        var path = request.RequestUri?.AbsolutePath ?? "";
        RequestPaths.Add(path);

        // Contract: GET /social/internal/friends/{userId1:guid}/{userId2:guid}
        // The real Social Service uses ASP.NET minimal API with :guid route constraints.
        // Invalid GUIDs never reach the handler — the framework returns 404.
        var prefix = "/social/internal/friends/";
        if (!path.StartsWith(prefix))
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

        var remainder = path[prefix.Length..];
        var parts = remainder.Split('/');
        if (parts.Length != 2)
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

        // Replicate :guid route constraint — non-GUID segments return 404
        if (!Guid.TryParse(parts[0], out _) || !Guid.TryParse(parts[1], out _))
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

        var key = $"{parts[0]}|{parts[1]}";

        // Contract: only Accepted friendships return 200
        // Pending friendships return 404 (same as no friendship)
        if (_acceptedFriendships.Contains(key))
        {
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new { areFriends = true })
            });
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}

public class FriendshipContractTests : IClassFixture<FriendshipContractFixture>, IAsyncLifetime
{
    private readonly FriendshipContractFixture _fixture;
    private readonly Guid _creatorId = Guid.NewGuid();
    private readonly Guid _recipientId = Guid.NewGuid();
    private readonly Guid _habitId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public FriendshipContractTests(FriendshipContractFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task CreateChallenge_AcceptedFriendship_Succeeds()
    {
        _fixture.ContractHandler.AddAcceptedFriendship(_creatorId, _recipientId);

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);
        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Contract test: accepted friendship"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(_creatorId, body.GetProperty("creatorId").GetGuid());
        Assert.Equal(_recipientId, body.GetProperty("recipientId").GetGuid());
    }

    [Fact]
    public async Task CreateChallenge_NoFriendship_Returns400()
    {
        // No friendship registered — contract handler returns 404, Challenge Service maps to 400
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);
        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Contract test: no friendship"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("You can only challenge friends", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_PendingFriendship_Returns400()
    {
        // Pending friendship should NOT allow challenge creation.
        // The real Social Service only returns 200 for Accepted friendships.
        _fixture.ContractHandler.AddPendingFriendship(_creatorId, _recipientId);

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);
        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Contract test: pending friendship"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("You can only challenge friends", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ChallengeService_CallsCorrectRoute()
    {
        // Verify the Challenge Service calls the exact route the Social Service exposes.
        // Route drift (e.g., /friends/ vs /social/internal/friends/) would cause silent failures.
        _fixture.ContractHandler.AddAcceptedFriendship(_creatorId, _recipientId);

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);
        await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Route verification test"
        }, CT);

        Assert.Single(_fixture.ContractHandler.RequestPaths);
        var calledPath = _fixture.ContractHandler.RequestPaths[0];
        Assert.StartsWith("/social/internal/friends/", calledPath);
        Assert.Contains(_creatorId.ToString(), calledPath);
        Assert.Contains(_recipientId.ToString(), calledPath);
    }
}
