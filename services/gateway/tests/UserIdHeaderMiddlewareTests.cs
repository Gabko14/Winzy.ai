using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Winzy.Gateway.Middleware;

namespace Winzy.Gateway.Tests;

public class UserIdHeaderMiddlewareTests
{
    private const string UserIdHeader = "X-User-Id";

    private static UserIdHeaderMiddleware CreateMiddleware(Action<HttpContext>? onNext = null)
    {
        return new UserIdHeaderMiddleware(context =>
        {
            onNext?.Invoke(context);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task AuthenticatedUser_SetsUserIdHeader_FromNameIdentifier()
    {
        var middleware = CreateMiddleware();
        var context = new DefaultHttpContext();
        var userId = "user-123";
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, userId)],
            "TestAuth"));

        await middleware.InvokeAsync(context);

        Assert.Equal(userId, context.Request.Headers[UserIdHeader].ToString());
    }

    [Fact]
    public async Task AuthenticatedUser_SetsUserIdHeader_FromSubClaim()
    {
        var middleware = CreateMiddleware();
        var context = new DefaultHttpContext();
        var userId = "user-456";
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", userId)],
            "TestAuth"));

        await middleware.InvokeAsync(context);

        Assert.Equal(userId, context.Request.Headers[UserIdHeader].ToString());
    }

    [Fact]
    public async Task AuthenticatedUser_PrefersNameIdentifier_OverSub()
    {
        var middleware = CreateMiddleware();
        var context = new DefaultHttpContext();
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, "name-id"),
                new Claim("sub", "sub-id")
            ],
            "TestAuth"));

        await middleware.InvokeAsync(context);

        Assert.Equal("name-id", context.Request.Headers[UserIdHeader].ToString());
    }

    [Fact]
    public async Task UnauthenticatedUser_DoesNotSetHeader()
    {
        var middleware = CreateMiddleware();
        var context = new DefaultHttpContext();
        // Default user is unauthenticated

        await middleware.InvokeAsync(context);

        Assert.False(context.Request.Headers.ContainsKey(UserIdHeader));
    }

    [Fact]
    public async Task StripsIncomingUserIdHeader_BeforeProcessing()
    {
        string? headerValueInNext = null;
        var middleware = CreateMiddleware(ctx =>
        {
            headerValueInNext = ctx.Request.Headers[UserIdHeader].ToString();
        });

        var context = new DefaultHttpContext();
        context.Request.Headers[UserIdHeader] = "spoofed-user-id";
        // Unauthenticated, so header should be stripped and not re-added

        await middleware.InvokeAsync(context);

        Assert.Equal(string.Empty, headerValueInNext);
    }

    [Fact]
    public async Task StripsIncomingHeader_ThenSetsFromClaims()
    {
        string? headerValueInNext = null;
        var middleware = CreateMiddleware(ctx =>
        {
            headerValueInNext = ctx.Request.Headers[UserIdHeader].ToString();
        });

        var context = new DefaultHttpContext();
        context.Request.Headers[UserIdHeader] = "spoofed-user-id";
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "real-user")],
            "TestAuth"));

        await middleware.InvokeAsync(context);

        Assert.Equal("real-user", headerValueInNext);
    }

    [Fact]
    public async Task AuthenticatedUser_WithNoClaims_DoesNotSetHeader()
    {
        var middleware = CreateMiddleware();
        var context = new DefaultHttpContext();
        // Authenticated but no NameIdentifier or sub claims
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Email, "test@example.com")],
            "TestAuth"));

        await middleware.InvokeAsync(context);

        Assert.False(context.Request.Headers.ContainsKey(UserIdHeader));
    }

    [Fact]
    public async Task CallsNextMiddleware()
    {
        var nextCalled = false;
        var middleware = new UserIdHeaderMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var context = new DefaultHttpContext();

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled);
    }
}
