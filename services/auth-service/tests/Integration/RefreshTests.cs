using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class RefreshTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Refresh_WithValidToken_ReturnsNewTokens()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("refresh1@example.com", "refreshuser1", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        var response = await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest(registerBody!.RefreshToken), CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(CT);
        Assert.NotNull(body);
        Assert.NotEmpty(body!.AccessToken);
        Assert.NotNull(body.RefreshToken);
        Assert.NotEqual(registerBody.RefreshToken, body.RefreshToken);
    }

    [Fact]
    public async Task Refresh_WithRevokedToken_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("refresh2@example.com", "refreshuser2", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);
        var originalRefreshToken = registerBody!.RefreshToken;

        // Use the refresh token once (rotates it)
        await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest(originalRefreshToken), CT);

        // Try to use the old (now revoked) token again
        var response = await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest(originalRefreshToken), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refresh_WithInvalidToken_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest("completely-invalid-token"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refresh_WithNoToken_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest(null), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refresh_SetsNewCookie()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("refresh3@example.com", "refreshuser3", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        var response = await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest(registerBody!.RefreshToken), CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var setCookie = response.Headers.GetValues("Set-Cookie").FirstOrDefault();
        Assert.NotNull(setCookie);
        Assert.Contains("refresh_token=", setCookie);
    }
}
