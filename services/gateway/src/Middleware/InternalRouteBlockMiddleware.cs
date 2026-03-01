namespace Winzy.Gateway.Middleware;

public class InternalRouteBlockMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        if (path.StartsWith("/habits/user/", StringComparison.OrdinalIgnoreCase)
            || path.Contains("/internal/", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }
}
