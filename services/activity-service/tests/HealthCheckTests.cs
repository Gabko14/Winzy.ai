using System.Net;

namespace Winzy.ActivityService.Tests;

public class HealthCheckTests
{
    [Fact]
    public async Task HealthEndpoint_ReturnsHealthy()
    {
        await using var factory = new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
