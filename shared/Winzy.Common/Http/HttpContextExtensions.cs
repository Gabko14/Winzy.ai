using Microsoft.AspNetCore.Http;

namespace Winzy.Common.Http;

public static class HttpContextExtensions
{
    private const string UserIdHeader = "X-User-Id";

    /// <summary>
    /// Extracts the user ID from the X-User-Id header set by the gateway.
    /// Returns true when the header contains a valid GUID.
    /// </summary>
    public static bool TryGetUserId(this HttpContext context, out Guid userId)
    {
        userId = Guid.Empty;
        var header = context.Request.Headers[UserIdHeader].FirstOrDefault();
        return header is not null && Guid.TryParse(header, out userId);
    }

    /// <summary>
    /// Extracts the user ID from the X-User-Id header set by the gateway.
    /// Returns null when the header is missing or not a valid GUID.
    /// </summary>
    public static Guid? GetUserId(this HttpContext context)
    {
        var header = context.Request.Headers[UserIdHeader].FirstOrDefault();
        return Guid.TryParse(header, out var id) ? id : null;
    }
}
