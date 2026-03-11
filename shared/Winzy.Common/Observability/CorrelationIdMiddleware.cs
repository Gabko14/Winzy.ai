using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Winzy.Common.Observability;

/// <summary>
/// Reads or generates X-Correlation-Id for each request.
/// Sets it in the ambient CorrelationContext, adds it to the response headers,
/// and pushes it into an ILogger scope so all downstream log entries include it.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers[CorrelationContext.HeaderName].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(correlationId))
            correlationId = Guid.NewGuid().ToString("N");

        CorrelationContext.CorrelationId = correlationId;
        try
        {
            context.Response.OnStarting(() =>
            {
                context.Response.Headers[CorrelationContext.HeaderName] = correlationId;
                return Task.CompletedTask;
            });

            using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
            {
                await next(context);
            }
        }
        finally
        {
            CorrelationContext.CorrelationId = null;
        }
    }
}
