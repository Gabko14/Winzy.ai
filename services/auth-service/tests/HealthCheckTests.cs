using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Winzy.AuthService.Data;

namespace Winzy.AuthService.Tests;

public class HealthCheckTests
{
    [Fact]
    public async Task HealthEndpoint_ReturnsHealthy()
    {
        await using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    // Remove ALL EF Core and Npgsql registrations to avoid dual-provider conflict.
                    var efDescriptors = services
                        .Where(d =>
                            d.ServiceType.FullName?.Contains("EntityFrameworkCore") == true ||
                            d.ServiceType.FullName?.Contains("Npgsql") == true ||
                            d.ServiceType == typeof(DbContextOptions<AuthDbContext>) ||
                            d.ImplementationType?.FullName?.Contains("DatabaseMigrationService") == true)
                        .ToList();

                    foreach (var descriptor in efDescriptors)
                        services.Remove(descriptor);

                    services.AddDbContext<AuthDbContext>(options =>
                        options.UseInMemoryDatabase("health-check-test"));
                });
            });

        using var client = factory.CreateClient();
        var response = await client.GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
