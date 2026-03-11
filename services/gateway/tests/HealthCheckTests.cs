using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Winzy.Gateway.Tests;

[Collection("Gateway")]
public class HealthCheckTests : IDisposable
{
    private const string TestSecret = "test-secret-key-that-is-long-enough-for-hmac-sha256-validation";

    public HealthCheckTests()
    {
        // Must set via env var because minimal API reads config inline
        // before WebApplicationFactory's ConfigureAppConfiguration runs.
        Environment.SetEnvironmentVariable("Jwt__Secret", TestSecret);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("Jwt__Secret", null);
    }

    [Fact]
    public async Task HealthEndpoint_ReturnsResponse()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        // Gateway health checks probe downstream services which aren't running in tests,
        // so expect ServiceUnavailable (unhealthy). The important thing is the endpoint exists.
        Assert.True(
            response.StatusCode is HttpStatusCode.OK or HttpStatusCode.ServiceUnavailable,
            $"Expected OK or ServiceUnavailable but got {response.StatusCode}");
    }
}
