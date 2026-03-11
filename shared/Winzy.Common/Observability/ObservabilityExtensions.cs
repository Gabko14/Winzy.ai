using Microsoft.AspNetCore.Builder;

namespace Winzy.Common.Observability;

public static class ObservabilityExtensions
{
    /// <summary>
    /// Adds correlation ID and request logging middleware to the pipeline.
    /// Call early in the pipeline — before authentication and routing — so all
    /// downstream middleware and handlers inherit the correlation scope.
    /// </summary>
    public static IApplicationBuilder UseObservability(this IApplicationBuilder app)
    {
        app.UseMiddleware<CorrelationIdMiddleware>();
        app.UseMiddleware<RequestLoggingMiddleware>();
        return app;
    }
}
