using System.Net;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests;

public class HealthCheckTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    [Fact]
    public async Task HealthEndpoint_ReturnsHealthy()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.Contains("\"status\"", body);
    }
}
