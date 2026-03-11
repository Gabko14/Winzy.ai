using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Winzy.Gateway.Tests;

[Collection("Gateway")]
public class HealthCheckTests : IDisposable
{
    private const string TestSecret = "test-secret-key-that-is-long-enough-for-hmac-sha256-validation";

    public HealthCheckTests()
    {
        Environment.SetEnvironmentVariable("Jwt__Secret", TestSecret);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("Jwt__Secret", null);
    }

    [Fact]
    public async Task HealthEndpoint_ReportsDownstreamServices()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        // Gateway health checks probe downstream services which aren't running in tests,
        // so expect ServiceUnavailable (unhealthy).
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal("Unhealthy", root.GetProperty("status").GetString());

        // Verify the aggregated response includes entries for each downstream service
        var checks = root.GetProperty("checks");
        var expectedServices = new[]
        {
            "auth-service", "habit-service", "social-service",
            "challenge-service", "notification-service", "activity-service"
        };

        foreach (var service in expectedServices)
        {
            Assert.True(checks.TryGetProperty(service, out var entry),
                $"Expected downstream check '{service}' in health response. Available: {checks}");
            Assert.Equal("Unhealthy", entry.GetProperty("status").GetString());
        }
    }

    [Fact]
    public async Task HealthEndpoint_ReturnsJsonWithValidContract()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.True(root.TryGetProperty("status", out _), "Health response must include 'status'");
        Assert.True(root.TryGetProperty("totalDuration", out _), "Health response must include 'totalDuration'");
        Assert.True(root.TryGetProperty("checks", out _), "Health response must include 'checks' object");
    }
}
