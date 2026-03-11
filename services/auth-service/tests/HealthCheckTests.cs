using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests;

public class HealthCheckTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    [Fact]
    public async Task HealthEndpoint_WithRealDependencies_ReportsDbAndNats()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal("Healthy", root.GetProperty("status").GetString());

        var checks = root.GetProperty("checks");
        Assert.True(checks.TryGetProperty("auth-db", out var dbCheck) ||
                    checks.TryGetProperty("AuthDbContext", out dbCheck),
            $"Expected a DB health check entry. Available checks: {checks}");
        Assert.Equal("Healthy", dbCheck.GetProperty("status").GetString());

        Assert.True(checks.TryGetProperty("nats", out var natsCheck),
            $"Expected a 'nats' health check entry. Available checks: {checks}");
        Assert.Equal("Healthy", natsCheck.GetProperty("status").GetString());
    }

    [Fact]
    public async Task HealthEndpoint_WithUnhealthyCheck_ReportsServiceUnavailable()
    {
        // Replace the NATS health check with one that always returns Unhealthy.
        // This verifies the health endpoint correctly reports degraded dependencies
        // and returns 503 instead of a blind 200.
        await using var factory = fixture.CreateFactory()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    services.Configure<HealthCheckServiceOptions>(options =>
                    {
                        var existing = options.Registrations.FirstOrDefault(r => r.Name == "nats");
                        if (existing != null)
                            options.Registrations.Remove(existing);

                        options.Registrations.Add(new HealthCheckRegistration(
                            "nats",
                            _ => new AlwaysUnhealthyCheck("NATS simulated failure"),
                            HealthStatus.Unhealthy,
                            ["ready"]));
                    });
                });
            });
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal("Unhealthy", root.GetProperty("status").GetString());

        var checks = root.GetProperty("checks");
        Assert.True(checks.TryGetProperty("nats", out var natsCheck),
            $"Expected a 'nats' health check entry. Available checks: {checks}");
        Assert.Equal("Unhealthy", natsCheck.GetProperty("status").GetString());
    }

    private sealed class AlwaysUnhealthyCheck(string description) : IHealthCheck
    {
        public Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context, CancellationToken cancellationToken = default)
            => Task.FromResult(HealthCheckResult.Unhealthy(description));
    }
}
