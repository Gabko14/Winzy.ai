using System.Text.Json;
using System.Text.Json.Serialization;

namespace Winzy.Common.Json;

public static class JsonDefaults
{
    /// <summary>
    /// Standard JSON options used across all Winzy services:
    /// camelCase property names and camelCase string enum values.
    /// </summary>
    public static JsonSerializerOptions CamelCase { get; } = CreateCamelCase();

    private static JsonSerializerOptions CreateCamelCase()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
        };
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }
}
