using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Winzy.Gateway.Tests;

public class HealthCheckTests
{
    [Fact]
    public async Task HealthEndpoint_ReturnsResponse()
    {
        await using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureAppConfiguration((_, config) =>
                {
                    config.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["Jwt:Secret"] = "test-secret-key-that-is-long-enough-for-hmac-sha256-validation"
                    });
                });
            });

        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        // Gateway health checks probe downstream services which aren't running in tests,
        // so expect ServiceUnavailable (unhealthy). The important thing is the endpoint exists.
        Assert.True(
            response.StatusCode is HttpStatusCode.OK or HttpStatusCode.ServiceUnavailable,
            $"Expected OK or ServiceUnavailable but got {response.StatusCode}");
    }
}
