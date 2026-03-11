using System.Net;
using System.Net.Http.Json;
using Winzy.AuthService.Models;
using Winzy.AuthService.Tests.Fixtures;

namespace Winzy.AuthService.Tests.Integration;

public class UserSearchTests(AuthServiceFixture fixture) : IClassFixture<AuthServiceFixture>
{
    private CancellationToken CT => TestContext.Current.CancellationToken;

    private static async Task<HttpClient> CreateAuthenticatedClient(AuthServiceFixture fixture, CancellationToken ct)
    {
        var factory = fixture.CreateFactory();
        var client = factory.CreateClient();
        var email = $"searcher-{Guid.NewGuid():N}@example.com";
        var username = $"searcher{Guid.NewGuid():N}"[..20];
        var response = await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest(email, username, "Password123!", null), ct);
        var body = await response.Content.ReadFromJsonAsync<AuthResponse>(ct);
        client.DefaultRequestHeaders.Add("X-User-Id", body!.User.Id.ToString());
        return client;
    }

    [Fact]
    public async Task Search_ByUsername_ReturnsMatches()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("search1@example.com", "searchable1", "Password123!", "Alice"), CT);

        var response = await client.GetAsync("/auth/users/search?q=searchable", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.Contains(results!, r => r.Username == "searchable1");
    }

    [Fact]
    public async Task Search_ByDisplayName_ReturnsMatches()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("search2@example.com", "searchdn1", "Password123!", "FindableUser"), CT);

        var response = await client.GetAsync("/auth/users/search?q=findable", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.Contains(results!, r => r.DisplayName == "FindableUser");
    }

    [Fact]
    public async Task Search_ReturnsLimitedFields()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        await client.PostAsJsonAsync("/auth/register",
            new RegisterRequest("search3@example.com", "limitedfields1", "Password123!", "Test"), CT);

        var response = await client.GetAsync("/auth/users/search?q=limitedfields", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.NotEmpty(results!);

        var result = results.First();
        Assert.NotEqual(Guid.Empty, result.Id);
        Assert.Equal("limitedfields1", result.Username);
    }

    [Fact]
    public async Task Search_ShortQuery_ReturnsEmpty()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        var response = await client.GetAsync("/auth/users/search?q=a", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.Empty(results!);
    }

    [Fact]
    public async Task Search_EmptyQuery_ReturnsEmpty()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        var response = await client.GetAsync("/auth/users/search?q=", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.Empty(results!);
    }

    [Fact]
    public async Task Search_NoQuery_ReturnsEmpty()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        var response = await client.GetAsync("/auth/users/search", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.Empty(results!);
    }

    [Fact]
    public async Task Search_NoMatch_ReturnsEmpty()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        var response = await client.GetAsync("/auth/users/search?q=zzzznonexistent", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.Empty(results!);
    }

    [Fact]
    public async Task Search_LimitsResultsTo20()
    {
        using var client = await CreateAuthenticatedClient(fixture, CT);

        for (int i = 0; i < 25; i++)
        {
            await client.PostAsJsonAsync("/auth/register",
                new RegisterRequest($"bulk{i}@example.com", $"bulkuser{i:D3}", "Password123!", null), CT);
        }

        var response = await client.GetAsync("/auth/users/search?q=bulkuser", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var results = await response.Content.ReadFromJsonAsync<List<UserSearchResult>>(CT);
        Assert.NotNull(results);
        Assert.True(results!.Count <= 20);
    }
}
