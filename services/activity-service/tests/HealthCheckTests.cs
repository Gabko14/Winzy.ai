using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Winzy.ActivityService.Tests;

public class HealthCheckTests
{
    [Fact]
    public async Task HealthEndpoint_ReturnsHealthyWithValidContract()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
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
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    }
}
