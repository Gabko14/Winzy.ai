using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class LogoutTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Logout_WithValidSession_ReturnsNoContent()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("logout1@example.com", "logoutuser1", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());
        client.DefaultRequestHeaders.Add("Cookie", $"refresh_token={registerBody.RefreshToken}");

        var response = await client.PostAsync("/auth/logout", null, CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Logout_InvalidatesRefreshToken()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("logout2@example.com", "logoutuser2", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());
        client.DefaultRequestHeaders.Add("Cookie", $"refresh_token={registerBody.RefreshToken}");

        await client.PostAsync("/auth/logout", null, CT);

        // Try to use the refresh token after logout
        client.DefaultRequestHeaders.Remove("Cookie");
        client.DefaultRequestHeaders.Remove("X-User-Id");
        var refreshResponse = await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest(registerBody.RefreshToken), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, refreshResponse.StatusCode);
    }

    [Fact]
    public async Task Logout_WithoutUserId_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync("/auth/logout", null, CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
