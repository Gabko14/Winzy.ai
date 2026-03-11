using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class ProfileTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task GetProfile_ReturnsUserProfile()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("profile1@example.com", "profileuser1", "Password123!", "My Name"), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());

        var response = await client.GetAsync("/auth/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var profile = await response.Content.ReadFromJsonAsync<UserProfile>(CT);
        Assert.NotNull(profile);
        Assert.Equal("profile1@example.com", profile!.Email);
        Assert.Equal("profileuser1", profile.Username);
        Assert.Equal("My Name", profile.DisplayName);
    }

    [Fact]
    public async Task GetProfile_WithoutUserId_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/auth/profile", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetProfile_WithNonexistentUser_ReturnsNotFound()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        client.DefaultRequestHeaders.Add("X-User-Id", Guid.NewGuid().ToString());

        var response = await client.GetAsync("/auth/profile", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateProfile_ChangesDisplayName()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("profile2@example.com", "profileuser2", "Password123!", "Old Name"), CT);
        var registerBody = await registerResponse.Content.ReadFromJsonAsync<AuthResponse>(CT);

        client.DefaultRequestHeaders.Add("X-User-Id", registerBody!.User.Id.ToString());

        var response = await client.PutAsJsonAsync("/auth/profile",
            new UpdateProfileRequest("New Name", null), CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var profile = await response.Content.ReadFromJsonAsync<UserProfile>(CT);
        Assert.Equal("New Name", profile!.DisplayName);
    }

    [Fact]
    public async Task UpdateProfile_WithoutUserId_ReturnsUnauthorized()
    {
        await using var factory = fixture.CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync("/auth/profile",
            new UpdateProfileRequest("Name", null), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
