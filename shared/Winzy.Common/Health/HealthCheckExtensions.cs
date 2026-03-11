using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Winzy.Common.Health;

public static class HealthCheckExtensions
{
    public static IHealthChecksBuilder AddNatsHealthCheck(
        this IHealthChecksBuilder builder)
    {
        return builder.AddCheck<NatsHealthCheck>("nats", tags: ["ready"]);
    }

    public static IEndpointConventionBuilder MapServiceHealthChecks(
        this IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapHealthChecks("/health", new HealthCheckOptions
        {
            ResponseWriter = HealthCheckResponseWriter.WriteAsync
        });
    }
}
