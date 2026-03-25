using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Winzy.Common.Http;
using Winzy.Common.Json;

namespace Winzy.Common.Tests;

public class RequestBodyHelperTests
{
    private static HttpRequest CreateRequest(string? json, string contentType = "application/json")
    {
        var context = new DefaultHttpContext();
        if (json is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            context.Request.Body = new MemoryStream(bytes);
            context.Request.ContentLength = bytes.Length;
            context.Request.ContentType = contentType;
        }
        return context.Request;
    }

    [Fact]
    public async Task TryReadBodyAsync_ValidJson_ReturnsBody()
    {
        var request = CreateRequest("""{"name":"test","value":42}""");

        var (body, error) = await request.TryReadBodyAsync<SampleDto>(JsonDefaults.CamelCase);

        Assert.Null(error);
        Assert.NotNull(body);
        Assert.Equal("test", body.Name);
        Assert.Equal(42, body.Value);
    }

    [Fact]
    public async Task TryReadBodyAsync_InvalidJson_ReturnsError()
    {
        var request = CreateRequest("{not valid json}");

        var (body, error) = await request.TryReadBodyAsync<SampleDto>(JsonDefaults.CamelCase);

        Assert.NotNull(error);
        Assert.Null(body);
    }

    [Fact]
    public async Task TryReadBodyAsync_EmptyBody_ReturnsNullBody()
    {
        var request = CreateRequest("null");

        var (body, error) = await request.TryReadBodyAsync<SampleDto>(JsonDefaults.CamelCase);

        Assert.Null(error);
        Assert.Null(body);
    }

    [Fact]
    public async Task TryReadBodyAsync_WithoutOptions_UsesDefaultSerialization()
    {
        var request = CreateRequest("""{"Name":"test","Value":1}""");

        var (body, error) = await request.TryReadBodyAsync<SampleDto>();

        Assert.Null(error);
        Assert.NotNull(body);
        Assert.Equal("test", body.Name);
    }

    private record SampleDto(string Name, int Value);
}
