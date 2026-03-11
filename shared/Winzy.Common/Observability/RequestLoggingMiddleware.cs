using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Winzy.Common.Observability;

/// <summary>
/// Logs HTTP request completion with method, route, status code, latency, and user ID.
/// Must run after CorrelationIdMiddleware (correlation ID is already in the log scope).
/// Skips /health to avoid log noise.
/// </summary>
public sealed class RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        // Skip health checks to reduce noise
        if (path.Equals("/health", StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await next(context);
        }
        finally
        {
            stopwatch.Stop();
            var userId = context.Request.Headers["X-User-Id"].FirstOrDefault();

            logger.LogInformation(
                "HTTP {Method} {Path} responded {StatusCode} in {ElapsedMs}ms UserId={UserId}",
                context.Request.Method,
                path,
                context.Response.StatusCode,
                stopwatch.ElapsedMilliseconds,
                userId ?? "-");
        }
    }
}
