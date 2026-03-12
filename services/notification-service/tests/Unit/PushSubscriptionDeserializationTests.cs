using System.Text.Json;
using Xunit;

namespace Winzy.NotificationService.Tests.Unit;

public class PushSubscriptionDeserializationTests
{
    private static readonly JsonSerializerOptions _caseInsensitiveOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    [Fact]
    public void Deserialize_LowercaseJson_ParsesCorrectly()
    {
        var json = """{"endpoint":"https://push.example.com/sub/abc","keys":{"p256dh":"key1","auth":"key2"}}""";

        var result = JsonSerializer.Deserialize<WebPushSubscriptionDto>(json, _caseInsensitiveOptions);

        Assert.NotNull(result);
        Assert.Equal("https://push.example.com/sub/abc", result.Endpoint);
        Assert.NotNull(result.Keys);
        Assert.Equal("key1", result.Keys.P256dh);
        Assert.Equal("key2", result.Keys.Auth);
    }

    [Fact]
    public void Deserialize_PascalCaseJson_ParsesCorrectly()
    {
        var json = """{"Endpoint":"https://push.example.com/sub/abc","Keys":{"P256dh":"key1","Auth":"key2"}}""";

        var result = JsonSerializer.Deserialize<WebPushSubscriptionDto>(json, _caseInsensitiveOptions);

        Assert.NotNull(result);
        Assert.Equal("https://push.example.com/sub/abc", result.Endpoint);
        Assert.NotNull(result.Keys);
        Assert.Equal("key1", result.Keys.P256dh);
        Assert.Equal("key2", result.Keys.Auth);
    }

    [Fact]
    public void Deserialize_LowercaseJson_WithoutCaseInsensitive_FailsToParseFields()
    {
        // This proves the bug: without PropertyNameCaseInsensitive, lowercase JSON
        // produces null properties, which would cause PushDeliveryService to delete the token.
        var json = """{"endpoint":"https://push.example.com/sub/abc","keys":{"p256dh":"key1","auth":"key2"}}""";

        var result = JsonSerializer.Deserialize<WebPushSubscriptionDto>(json);

        Assert.NotNull(result);
        // Without case-insensitive, PascalCase properties don't match lowercase JSON keys
        Assert.Null(result.Endpoint);
        Assert.Null(result.Keys);
    }

    // Mirrors the private DTOs in PushDeliveryService to test the exact same deserialization path
    private sealed record WebPushSubscriptionDto(string? Endpoint, WebPushKeysDto? Keys);
    private sealed record WebPushKeysDto(string? P256dh, string? Auth);
}
