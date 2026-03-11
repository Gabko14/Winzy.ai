using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class LoginTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Login_WithEmail_ReturnsOk()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("login1@example.com", "loginuser1", "Password123!", null), CT);

        var response = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("login1@example.com", "Password123!"), CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(CT);
        Assert.NotNull(body);
        Assert.NotEmpty(body!.AccessToken);
        Assert.NotNull(body.RefreshToken);
        Assert.Equal("login1@example.com", body.User.Email);
    }

    [Fact]
    public async Task Login_WithUsername_ReturnsOk()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("login2@example.com", "loginuser2", "Password123!", null), CT);

        var response = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("loginuser2", "Password123!"), CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(CT);
        Assert.NotNull(body);
        Assert.Equal("loginuser2", body!.User.Username);
    }

    [Fact]
    public async Task Login_WrongPassword_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("login3@example.com", "loginuser3", "Password123!", null), CT);

        var response = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("login3@example.com", "WrongPassword!"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_NonexistentUser_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("nonexistent@example.com", "Password123!"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_SetsRefreshTokenCookie()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("login4@example.com", "loginuser4", "Password123!", null), CT);

        var response = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("login4@example.com", "Password123!"), CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var setCookie = response.Headers.GetValues("Set-Cookie").FirstOrDefault();
        Assert.NotNull(setCookie);
        Assert.Contains("refresh_token=", setCookie);
    }

    [Fact]
    public async Task Login_IsCaseInsensitive()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("CaseTest@Example.COM", "caseuser1", "Password123!", null), CT);

        var response = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("casetest@example.com", "Password123!"), CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
