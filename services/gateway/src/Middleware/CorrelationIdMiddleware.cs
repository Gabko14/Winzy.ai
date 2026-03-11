namespace Winzy.Gateway.Middleware;

/// <summary>
/// Reads or generates X-Correlation-Id for each request.
/// Adds it to the response and pushes it into the ILogger scope so all
/// downstream log entries include it. Also forwards it to backend services
/// via the request headers so YARP proxies it.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
{
    private const string HeaderName = "X-Correlation-Id";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers[HeaderName].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(correlationId))
        {
            correlationId = Guid.NewGuid().ToString("N");
            // Set on the request so YARP forwards it to backend services
            context.Request.Headers[HeaderName] = correlationId;
        }

        context.Response.OnStarting(() =>
        {
            context.Response.Headers[HeaderName] = correlationId;
            return Task.CompletedTask;
        });

        using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
        {
            await next(context);
        }
    }
}
