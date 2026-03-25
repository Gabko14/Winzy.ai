using Microsoft.AspNetCore.Http;
using Winzy.Common.Http;

namespace Winzy.Common.Tests;

public class HttpContextExtensionsTests
{
    private static HttpContext CreateContext(string? userIdHeader)
    {
        var context = new DefaultHttpContext();
        if (userIdHeader is not null)
            context.Request.Headers["X-User-Id"] = userIdHeader;
        return context;
    }

    // --- TryGetUserId ---

    [Fact]
    public void TryGetUserId_ValidGuid_ReturnsTrueAndParsedId()
    {
        var expected = Guid.NewGuid();
        var ctx = CreateContext(expected.ToString());

        var result = ctx.TryGetUserId(out var userId);

        Assert.True(result);
        Assert.Equal(expected, userId);
    }

    [Fact]
    public void TryGetUserId_MissingHeader_ReturnsFalse()
    {
        var ctx = CreateContext(null);

        var result = ctx.TryGetUserId(out var userId);

        Assert.False(result);
        Assert.Equal(Guid.Empty, userId);
    }

    [Fact]
    public void TryGetUserId_EmptyString_ReturnsFalse()
    {
        var ctx = CreateContext("");

        var result = ctx.TryGetUserId(out var userId);

        Assert.False(result);
        Assert.Equal(Guid.Empty, userId);
    }

    [Fact]
    public void TryGetUserId_InvalidGuid_ReturnsFalse()
    {
        var ctx = CreateContext("not-a-guid");

        var result = ctx.TryGetUserId(out var userId);

        Assert.False(result);
        Assert.Equal(Guid.Empty, userId);
    }

    // --- GetUserId (nullable variant) ---

    [Fact]
    public void GetUserId_ValidGuid_ReturnsId()
    {
        var expected = Guid.NewGuid();
        var ctx = CreateContext(expected.ToString());

        var result = ctx.GetUserId();

        Assert.Equal(expected, result);
    }

    [Fact]
    public void GetUserId_MissingHeader_ReturnsNull()
    {
        var ctx = CreateContext(null);

        Assert.Null(ctx.GetUserId());
    }

    [Fact]
    public void GetUserId_EmptyString_ReturnsNull()
    {
        var ctx = CreateContext("");

        Assert.Null(ctx.GetUserId());
    }

    [Fact]
    public void GetUserId_InvalidGuid_ReturnsNull()
    {
        var ctx = CreateContext("not-a-guid");

        Assert.Null(ctx.GetUserId());
    }
}
