using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace Winzy.Common.Http;

public static class RequestBodyHelper
{
    /// <summary>
    /// Reads and deserializes the request body as JSON.
    /// Returns the deserialized value on success, or an IResult error
    /// when the body is missing or contains invalid JSON.
    /// </summary>
    public static async Task<(T? Body, IResult? Error)> TryReadBodyAsync<T>(
        this HttpRequest request, JsonSerializerOptions? options = null)
    {
        try
        {
            var body = await request.ReadFromJsonAsync<T>(options);
            return (body, null);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return (default, Results.BadRequest(new { error = "Invalid JSON in request body" }));
        }
    }
}
