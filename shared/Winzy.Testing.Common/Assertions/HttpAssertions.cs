using System.Linq.Expressions;
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Winzy.Testing.Common.Assertions;

/// <summary>
/// Convenience wrappers for common HTTP response assertions.
/// </summary>
public static class HttpAssertions
{
    /// <summary>
    /// Asserts that the response has status code 200 OK.
    /// </summary>
    public static void AssertOk(HttpResponseMessage response)
        => Assert.Equal(HttpStatusCode.OK, response.StatusCode);

    /// <summary>
    /// Asserts that the response has status code 201 Created.
    /// </summary>
    public static void AssertCreated(HttpResponseMessage response)
        => Assert.Equal(HttpStatusCode.Created, response.StatusCode);

    /// <summary>
    /// Asserts that the response has status code 400 Bad Request.
    /// </summary>
    public static void AssertBadRequest(HttpResponseMessage response)
        => Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

    /// <summary>
    /// Asserts that the response has status code 401 Unauthorized.
    /// </summary>
    public static void AssertUnauthorized(HttpResponseMessage response)
        => Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);

    /// <summary>
    /// Asserts that the response has status code 404 Not Found.
    /// </summary>
    public static void AssertNotFound(HttpResponseMessage response)
        => Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

    /// <summary>
    /// Deserializes the response body as JSON into <typeparamref name="T"/> and asserts the predicate holds.
    /// </summary>
    public static async Task AssertJsonContains<T>(HttpResponseMessage response, Expression<Func<T, bool>> predicate)
    {
        var body = await response.Content.ReadFromJsonAsync<T>();
        Assert.NotNull(body);

        var compiled = predicate.Compile();
        Assert.True(compiled(body!), $"JSON body of type {typeof(T).Name} did not match predicate: {predicate}");
    }
}
