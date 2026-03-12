using System.Net;
using System.Text.Json;
using Xunit;

namespace Winzy.ActivityService.Tests;

[Collection("ActivityService")]
public class HealthCheckTests
{
    private readonly ActivityServiceFixture _fixture;

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public HealthCheckTests(ActivityServiceFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task HealthEndpoint_ReturnsHealthyWithValidContract()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.GetAsync("/health", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync(CT);
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal("Healthy", root.GetProperty("status").GetString());
        Assert.True(root.TryGetProperty("totalDuration", out _),
            "Health response must include 'totalDuration'");
        Assert.True(root.TryGetProperty("checks", out _),
            "Health response must include 'checks' object");
    }

    [Fact]
    public async Task HealthEndpoint_ReturnsJsonContentType()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.GetAsync("/health", CT);

        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task HealthEndpoint_IncludesDbAndNatsChecks()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.GetAsync("/health", CT);
        var body = await response.Content.ReadAsStringAsync(CT);
        var root = JsonDocument.Parse(body).RootElement;

        var checks = root.GetProperty("checks");
        Assert.True(checks.TryGetProperty("ActivityDbContext", out _),
            "Health response must include ActivityDbContext check");
        Assert.True(checks.TryGetProperty("nats", out _),
            "Health response must include nats check");
    }
}
