using System.Security.Claims;

namespace Winzy.Gateway.Middleware;

public class UserIdHeaderMiddleware(RequestDelegate next)
{
    private const string UserIdHeader = "X-User-Id";
    private const string ResolvedUserIdHeader = "X-Resolved-User-Id";

    public async Task InvokeAsync(HttpContext context)
    {
        // Always strip incoming internal headers to prevent spoofing
        context.Request.Headers.Remove(UserIdHeader);
        context.Request.Headers.Remove(ResolvedUserIdHeader);

        if (context.User.Identity?.IsAuthenticated == true)
        {
            var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier)
                         ?? context.User.FindFirstValue("sub");

            if (!string.IsNullOrEmpty(userId))
            {
                context.Request.Headers[UserIdHeader] = userId;
            }
        }

        await next(context);
    }
}
