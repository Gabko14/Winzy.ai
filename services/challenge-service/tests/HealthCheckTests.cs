using System.Net;
using System.Text.Json;

namespace Winzy.ChallengeService.Tests;

public class HealthCheckTests : IClassFixture<ChallengeServiceFixture>
{
    private readonly ChallengeServiceFixture _fixture;

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public HealthCheckTests(ChallengeServiceFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task HealthEndpoint_ReturnsHealthyWithValidContract()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.GetAsync("/health", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync(CT);
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        // Verify the health response contract: status, totalDuration, checks
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
}
