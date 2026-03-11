using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class PasswordTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ChangePassword_WithCorrectCurrent_ReturnsNoContent()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("pw1@example.com", "pwuser1", "OldPassword1!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());

        var response = await client.PutAsJsonAsync("/auth/password",
            new ChangePasswordRequest("OldPassword1!", "NewPassword1!"), CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_CanLoginWithNewPassword()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("pw2@example.com", "pwuser2", "OldPassword1!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());

        await client.PutAsJsonAsync("/auth/password",
            new ChangePasswordRequest("OldPassword1!", "NewPassword1!"), CT);

        client.DefaultRequestHeaders.Remove("X-User-Id");

        var loginResponse = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("pw2@example.com", "NewPassword1!"), CT);

        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_OldPasswordNoLongerWorks()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("pw3@example.com", "pwuser3", "OldPassword1!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());

        await client.PutAsJsonAsync("/auth/password",
            new ChangePasswordRequest("OldPassword1!", "NewPassword1!"), CT);

        client.DefaultRequestHeaders.Remove("X-User-Id");

        var loginResponse = await client.PostAsJsonAsync("/auth/login",
            new LoginRequest("pw3@example.com", "OldPassword1!"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, loginResponse.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WrongCurrentPassword_ReturnsValidationProblem()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("pw4@example.com", "pwuser4", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());

        var response = await client.PutAsJsonAsync("/auth/password",
            new ChangePasswordRequest("WrongPassword!", "NewPassword1!"), CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_RevokesAllRefreshTokens()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("pw5@example.com", "pwuser5", "Password123!", null), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);
        var refreshToken = registerBody!.RefreshToken;

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody.User.Id.ToString());

        await client.PutAsJsonAsync("/auth/password",
            new ChangePasswordRequest("Password123!", "NewPassword1!"), CT);

        client.DefaultRequestHeaders.Remove("X-User-Id");

        var refreshResponse = await client.PostAsJsonAsync("/auth/refresh",
            new RefreshRequest(refreshToken), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, refreshResponse.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithoutUserId_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync("/auth/password",
            new ChangePasswordRequest("old", "newpassword1!"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
