using System.Diagnostics;

namespace Winzy.Gateway.Middleware;

/// <summary>
/// Logs HTTP request completion at the gateway level: method, path, status, latency, user ID.
/// Must run after CorrelationIdMiddleware. Skips /health to avoid log noise.
/// </summary>
public sealed class RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

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
