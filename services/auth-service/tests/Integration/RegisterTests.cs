using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class RegisterTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Register_WithValidData_ReturnsCreated()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("register1@example.com", "register1", "Password123!", "Test User");

        var response = await client.PostAsJsonAsync("/auth/register", request, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(CT);
        Assert.NotNull(body);
        Assert.NotEmpty(body!.AccessToken);
        Assert.NotNull(body.RefreshToken);
        Assert.Equal("register1@example.com", body.User.Email);
        Assert.Equal("register1", body.User.Username);
        Assert.Equal("Test User", body.User.DisplayName);
    }

    [Fact]
    public async Task Register_SetsRefreshTokenCookie()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("cookie1@example.com", "cookie1", "Password123!", null);
        var response = await client.PostAsJsonAsync("/auth/register", request, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var setCookie = response.Headers.GetValues("Set-Cookie").FirstOrDefault();
        Assert.NotNull(setCookie);
        Assert.Contains("refresh_token=", setCookie);
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", setCookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Register_NormalizesEmailAndUsername()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("  NormTest@Example.COM  ", "NormUser1", "Password123!", null);
        var response = await client.PostAsJsonAsync("/auth/register", request, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(CT);
        Assert.Equal("normtest@example.com", body!.User.Email);
        Assert.Equal("normuser1", body.User.Username);
    }

    [Fact]
    public async Task Register_DuplicateEmail_ReturnsConflict()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request1 = new RegisterRequest("dup1@example.com", "dupuser1", "Password123!", null);
        await client.PostAsJsonAsync("/auth/register", request1, CT);

        var request2 = new RegisterRequest("dup1@example.com", "dupuser2", "Password123!", null);
        var response = await client.PostAsJsonAsync("/auth/register", request2, CT);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Register_DuplicateUsername_ReturnsConflict()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request1 = new RegisterRequest("unique1@example.com", "sameuser", "Password123!", null);
        await client.PostAsJsonAsync("/auth/register", request1, CT);

        var request2 = new RegisterRequest("unique2@example.com", "sameuser", "Password123!", null);
        var response = await client.PostAsJsonAsync("/auth/register", request2, CT);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Register_InvalidEmail_ReturnsBadRequest()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("not-an-email", "validuser1", "Password123!", null);
        var response = await client.PostAsJsonAsync("/auth/register", request, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_InvalidUsername_ReturnsBadRequest()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("valid@example.com", "ab", "Password123!", null);
        var response = await client.PostAsJsonAsync("/auth/register", request, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_ShortPassword_ReturnsBadRequest()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("short@example.com", "shortpw1", "short", null);
        var response = await client.PostAsJsonAsync("/auth/register", request, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_WithoutDisplayName_SetsItToNull()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("noname1@example.com", "noname1", "Password123!", null);
        var response = await client.PostAsJsonAsync("/auth/register", request, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(CT);
        Assert.Null(body!.User.DisplayName);
    }
}
