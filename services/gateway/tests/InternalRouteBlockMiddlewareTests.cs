using System.Net;
using Microsoft.AspNetCore.Http;
using Winzy.Gateway.Middleware;

namespace Winzy.Gateway.Tests;

public class InternalRouteBlockMiddlewareTests
{
    [Theory]
    [InlineData("/habits/user/123")]
    [InlineData("/habits/user/some-guid")]
    [InlineData("/Habits/User/123")]
    [InlineData("/api/internal/something")]
    [InlineData("/services/internal/health")]
    [InlineData("/INTERNAL/route")]
    public async Task BlockedPaths_Return403(string path)
    {
        var nextCalled = false;
        var middleware = new InternalRouteBlockMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var context = new DefaultHttpContext();
        context.Request.Path = path;

        await middleware.InvokeAsync(context);

        Assert.Equal((int)HttpStatusCode.Forbidden, context.Response.StatusCode);
        Assert.False(nextCalled);
    }

    [Theory]
    [InlineData("/habits")]
    [InlineData("/habits/123")]
    [InlineData("/auth/login")]
    [InlineData("/health")]
    [InlineData("/social/friends")]
    [InlineData("/habits/public/username")]
    public async Task AllowedPaths_CallNext(string path)
    {
        var nextCalled = false;
        var middleware = new InternalRouteBlockMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var context = new DefaultHttpContext();
        context.Request.Path = path;

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled);
        Assert.Equal((int)HttpStatusCode.OK, context.Response.StatusCode);
    }

    [Fact]
    public async Task NullPath_CallsNext()
    {
        var nextCalled = false;
        var middleware = new InternalRouteBlockMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var context = new DefaultHttpContext();
        // Path defaults to empty, which should pass through

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled);
    }
}
