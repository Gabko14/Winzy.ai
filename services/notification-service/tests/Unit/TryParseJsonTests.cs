using System.Text.Json;
using Xunit;

namespace Winzy.NotificationService.Tests.Unit;

/// <summary>
/// Tests the TryParseJson fallback logic that Program.cs uses when mapping notification data.
/// TryParseJson is private static, so we replicate its exact implementation here to verify
/// that invalid JSON gracefully falls back to an empty object.
/// </summary>
public class TryParseJsonTests
{
    // Mirrors the exact implementation in Program.cs
    private static JsonElement TryParseJson(string json)
    {
        try
        { return JsonSerializer.Deserialize<JsonElement>(json); }
        catch (JsonException) { return JsonSerializer.Deserialize<JsonElement>("{}"); }
    }

    [Fact]
    public void ValidJson_ReturnsDeserialized()
    {
        var result = TryParseJson("""{"key":"value"}""");
        Assert.Equal(JsonValueKind.Object, result.ValueKind);
        Assert.Equal("value", result.GetProperty("key").GetString());
    }

    [Fact]
    public void EmptyObject_ReturnsEmptyObject()
    {
        var result = TryParseJson("{}");
        Assert.Equal(JsonValueKind.Object, result.ValueKind);
        Assert.Empty(result.EnumerateObject().ToArray());
    }

    [Fact]
    public void InvalidJson_ReturnsFallbackEmptyObject()
    {
        var result = TryParseJson("not valid json at all");
        Assert.Equal(JsonValueKind.Object, result.ValueKind);
        Assert.Empty(result.EnumerateObject().ToArray());
    }

    [Fact]
    public void EmptyString_ReturnsFallbackEmptyObject()
    {
        var result = TryParseJson("");
        Assert.Equal(JsonValueKind.Object, result.ValueKind);
        Assert.Empty(result.EnumerateObject().ToArray());
    }

    [Fact]
    public void TruncatedJson_ReturnsFallbackEmptyObject()
    {
        var result = TryParseJson("""{"key":"val""");
        Assert.Equal(JsonValueKind.Object, result.ValueKind);
        Assert.Empty(result.EnumerateObject().ToArray());
    }

    [Fact]
    public void ArrayJson_ReturnsArray()
    {
        var result = TryParseJson("[1,2,3]");
        Assert.Equal(JsonValueKind.Array, result.ValueKind);
        Assert.Equal(3, result.GetArrayLength());
    }
}
