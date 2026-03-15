using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Winzy.AuthService.Data;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;
using Xunit;

namespace Winzy.AuthService.Tests.Integration;

public class ExportTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> CreateFactoryWithMocks()
    {
        return fixture.CreateFactory()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    foreach (var name in MockDownstreamHandler.ServiceNames)
                    {
                        services.AddHttpClient(name)
                            .ConfigurePrimaryHttpMessageHandler(() => new MockDownstreamHandler());
                    }
                });
            });
    }

    private async Task<(Guid UserId, HttpClient Client)> RegisterAndGetClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        var unique = Guid.NewGuid().ToString("N")[..8];
        var request = new RegisterRequest($"export-{unique}@example.com", $"export{unique}", "Password123!", "Export User");
        var response = await client.PostAsJsonAsync("/auth/register", request, CT);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(CT);
        client.DefaultRequestHeaders.Add("X-User-Id", body!.User.Id.ToString());
        return (body.User.Id, client);
    }

    // --- GET /auth/internal/export/{userId} (per-service internal endpoint) ---

    [Fact]
    public async Task InternalExport_WithUser_ReturnsAuthData()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var unique = Guid.NewGuid().ToString("N")[..8];
        var regResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest($"intexp-{unique}@example.com", $"intexp{unique}", "Password123!", "Test User"), CT);
        var regBody = await regResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);
        var userId = regBody!.User.Id;

        var response = await client.GetAsync($"/auth/internal/export/{userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("auth", body.GetProperty("service").GetString());

        var data = body.GetProperty("data");
        Assert.Equal(userId, data.GetProperty("userId").GetGuid());
        Assert.Equal($"intexp{unique}", data.GetProperty("username").GetString());
        Assert.Equal($"intexp-{unique}@example.com", data.GetProperty("email").GetString());
        Assert.Equal("Test User", data.GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task InternalExport_UnknownUser_Returns404()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/auth/internal/export/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /auth/export (orchestrator fan-out) ---

    [Fact]
    public async Task Export_Orchestrator_AggregatesAllServices()
    {
        MockDownstreamHandler.Reset();

        MockDownstreamHandler.SetResponse("HabitService", HttpStatusCode.OK,
            new { service = "habit", data = new { habits = new[] { new { habitId = Guid.NewGuid(), name = "Exercise" } } } });
        MockDownstreamHandler.SetResponse("SocialService", HttpStatusCode.OK,
            new { service = "social", data = new { friends = Array.Empty<object>() } });
        MockDownstreamHandler.SetResponse("ChallengeService", HttpStatusCode.OK,
            new { service = "challenge", data = new { challenges = Array.Empty<object>() } });
        MockDownstreamHandler.SetResponse("NotificationService", HttpStatusCode.OK,
            new { service = "notification", data = new { settings = new { }, notifications = Array.Empty<object>() } });
        MockDownstreamHandler.SetResponse("ActivityService", HttpStatusCode.OK,
            new { service = "activity", data = new { feedEntries = Array.Empty<object>() } });

        await using var factory = CreateFactoryWithMocks();
        var (userId, client) = await RegisterAndGetClient(factory);

        var response = await client.GetAsync("/auth/export", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.TryGetProperty("exportedAt", out _));

        var services = body.GetProperty("services");
        // auth + 5 downstream = 6 services
        Assert.Equal(6, services.GetArrayLength());

        var warnings = body.GetProperty("warnings");
        Assert.Equal(0, warnings.GetArrayLength());
    }

    [Fact]
    public async Task Export_Orchestrator_PartialFailure_ReturnsWarnings()
    {
        MockDownstreamHandler.Reset();

        // HabitService fails with 500
        MockDownstreamHandler.SetResponse("HabitService", HttpStatusCode.InternalServerError, null);
        MockDownstreamHandler.SetResponse("SocialService", HttpStatusCode.OK,
            new { service = "social", data = new { friends = Array.Empty<object>() } });
        MockDownstreamHandler.SetResponse("ChallengeService", HttpStatusCode.OK,
            new { service = "challenge", data = new { challenges = Array.Empty<object>() } });
        MockDownstreamHandler.SetResponse("NotificationService", HttpStatusCode.OK,
            new { service = "notification", data = new { settings = new { }, notifications = Array.Empty<object>() } });
        MockDownstreamHandler.SetResponse("ActivityService", HttpStatusCode.OK,
            new { service = "activity", data = new { feedEntries = Array.Empty<object>() } });

        await using var factory = CreateFactoryWithMocks();
        var (userId, client) = await RegisterAndGetClient(factory);

        var response = await client.GetAsync("/auth/export", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);

        // auth + 4 successful downstream = 5 services
        var services = body.GetProperty("services");
        Assert.Equal(5, services.GetArrayLength());

        var warnings = body.GetProperty("warnings");
        Assert.Equal(1, warnings.GetArrayLength());
        Assert.Contains("HabitService", warnings[0].GetString());
    }

    [Fact]
    public async Task Export_Orchestrator_AllDownstream404_ReturnsOnlyAuth()
    {
        MockDownstreamHandler.Reset();

        foreach (var name in MockDownstreamHandler.ServiceNames)
            MockDownstreamHandler.SetResponse(name, HttpStatusCode.NotFound, null);

        await using var factory = CreateFactoryWithMocks();
        var (userId, client) = await RegisterAndGetClient(factory);

        var response = await client.GetAsync("/auth/export", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);

        // Only auth data
        var services = body.GetProperty("services");
        Assert.Equal(1, services.GetArrayLength());
        Assert.Equal("auth", services[0].GetProperty("service").GetString());

        // 404 is not a failure, no warnings
        var warnings = body.GetProperty("warnings");
        Assert.Equal(0, warnings.GetArrayLength());
    }

    [Fact]
    public async Task Export_Orchestrator_DownstreamTimeout_ReturnsWarning()
    {
        MockDownstreamHandler.Reset();

        MockDownstreamHandler.SetTimeout("HabitService");
        MockDownstreamHandler.SetResponse("SocialService", HttpStatusCode.NotFound, null);
        MockDownstreamHandler.SetResponse("ChallengeService", HttpStatusCode.NotFound, null);
        MockDownstreamHandler.SetResponse("NotificationService", HttpStatusCode.NotFound, null);
        MockDownstreamHandler.SetResponse("ActivityService", HttpStatusCode.NotFound, null);

        await using var factory = CreateFactoryWithMocks();
        var (userId, client) = await RegisterAndGetClient(factory);

        var response = await client.GetAsync("/auth/export", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var warnings = body.GetProperty("warnings");
        Assert.Equal(1, warnings.GetArrayLength());
        Assert.Contains("HabitService", warnings[0].GetString());
    }

    [Fact]
    public async Task Export_WithoutUserId_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/auth/export", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Export_NonexistentUser_ReturnsNotFound()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Id", Guid.NewGuid().ToString());

        var response = await client.GetAsync("/auth/export", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

internal class MockDownstreamHandler : HttpMessageHandler
{
    public static readonly string[] ServiceNames =
        ["HabitService", "SocialService", "ChallengeService", "NotificationService", "ActivityService"];

    private static readonly ConcurrentDictionary<string, (HttpStatusCode Status, string? Body)> _responses = new();
    private static readonly ConcurrentDictionary<string, bool> _timeouts = new();

    public static void SetResponse(string serviceName, HttpStatusCode status, object? body)
    {
        var json = body is not null ? JsonSerializer.Serialize(body) : null;
        _responses[serviceName] = (status, json);
    }

    public static void SetTimeout(string serviceName)
    {
        _timeouts[serviceName] = true;
    }

    public static void Reset()
    {
        _responses.Clear();
        _timeouts.Clear();
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? "";

        // Map path prefix to service name
        var serviceName = path switch
        {
            _ when path.StartsWith("/habits/") => "HabitService",
            _ when path.StartsWith("/social/") => "SocialService",
            _ when path.StartsWith("/challenges/") => "ChallengeService",
            _ when path.StartsWith("/notifications/") => "NotificationService",
            _ when path.StartsWith("/activity/") => "ActivityService",
            _ => null
        };

        if (serviceName is null)
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

        if (_timeouts.ContainsKey(serviceName))
            throw new TaskCanceledException("The request was canceled due to the configured timeout.");

        if (_responses.TryGetValue(serviceName, out var response))
        {
            var msg = new HttpResponseMessage(response.Status);
            if (response.Body is not null)
                msg.Content = new StringContent(response.Body, System.Text.Encoding.UTF8, "application/json");
            return Task.FromResult(msg);
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}
