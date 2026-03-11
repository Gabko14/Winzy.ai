using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class AccountDeleteTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task DeleteAccount_ReturnsNoContent()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("delete1@example.com", "deleteuser1", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());

        var response = await client.DeleteAsync("/auth/account", CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_CannotLoginAfterwards()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("delete2@example.com", "deleteuser2", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());
        await client.DeleteAsync("/auth/account", CT);

        client.DefaultRequestHeaders.Remove("X-User-Id");

        var loginResponse = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("delete2@example.com", "Password123!"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, loginResponse.StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_WithoutUserId_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.DeleteAsync("/auth/account", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_WithNonexistentUser_ReturnsNotFound()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        client.DefaultRequestHeaders.Add("X-User-Id", Guid.NewGuid().ToString());

        var response = await client.DeleteAsync("/auth/account", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
