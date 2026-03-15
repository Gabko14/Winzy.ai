using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.SocialService.Entities;
using Xunit;

namespace Winzy.SocialService.Tests;

[Collection("SocialService")]
public class ExportEndpointTests : IAsyncLifetime
{
    private readonly SocialServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _friendId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public ExportEndpointTests(SocialServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- Happy path ---

    [Fact]
    public async Task Export_WithFriendsAndPreferences_ReturnsFullData()
    {
        var now = DateTimeOffset.UtcNow;
        var habitId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.Friendships.Add(new Friendship
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                FriendId = _friendId,
                Status = FriendshipStatus.Accepted,
                CreatedAt = now.AddDays(-5),
                UpdatedAt = now.AddDays(-5)
            });

            db.SocialPreferences.Add(new SocialPreference
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                DefaultHabitVisibility = HabitVisibility.Friends,
                CreatedAt = now,
                UpdatedAt = now
            });

            db.VisibilitySettings.Add(new VisibilitySetting
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                HabitId = habitId,
                Visibility = HabitVisibility.Public,
                CreatedAt = now,
                UpdatedAt = now
            });

            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("social", body.GetProperty("service").GetString());

        var data = body.GetProperty("data");

        // Friends
        var friends = data.GetProperty("friends");
        Assert.Equal(1, friends.GetArrayLength());
        Assert.Equal(_friendId, friends[0].GetProperty("friendUserId").GetGuid());

        // Pending requests
        var pending = data.GetProperty("pendingRequests");
        Assert.Equal(0, pending.GetArrayLength());

        // Preferences
        var prefs = data.GetProperty("preferences");
        Assert.Equal("friends", prefs.GetProperty("defaultHabitVisibility").GetString());

        // Visibility settings
        var vis = data.GetProperty("visibilitySettings");
        Assert.Equal(1, vis.GetArrayLength());
        Assert.Equal(habitId, vis[0].GetProperty("habitId").GetGuid());
        Assert.Equal("public", vis[0].GetProperty("visibility").GetString());
    }

    [Fact]
    public async Task Export_WithPendingRequests_IncludesDirectionField()
    {
        var now = DateTimeOffset.UtcNow;
        var otherId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            // Sent by user
            db.Friendships.Add(new Friendship
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                FriendId = otherId,
                Status = FriendshipStatus.Pending,
                CreatedAt = now,
                UpdatedAt = now
            });

            // Received by user
            db.Friendships.Add(new Friendship
            {
                Id = Guid.NewGuid(),
                UserId = _friendId,
                FriendId = _userId,
                Status = FriendshipStatus.Pending,
                CreatedAt = now.AddMinutes(1),
                UpdatedAt = now.AddMinutes(1)
            });

            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var pending = body.GetProperty("data").GetProperty("pendingRequests");
        Assert.Equal(2, pending.GetArrayLength());

        var directions = new List<string>();
        for (int i = 0; i < pending.GetArrayLength(); i++)
            directions.Add(pending[i].GetProperty("direction").GetString()!);

        Assert.Contains("sent", directions);
        Assert.Contains("received", directions);
    }

    // --- Edge cases / Error conditions ---

    [Fact]
    public async Task Export_NoSocialData_Returns404()
    {
        var unknownUserId = Guid.NewGuid();

        using var client = _fixture.CreateAuthenticatedClient(unknownUserId);
        var response = await client.GetAsync($"/social/internal/export/{unknownUserId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Export_OnlyPreferences_ReturnsOk()
    {
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.SocialPreferences.Add(new SocialPreference
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                DefaultHabitVisibility = HabitVisibility.Public,
                CreatedAt = now,
                UpdatedAt = now
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("social", body.GetProperty("service").GetString());
        Assert.Equal(0, body.GetProperty("data").GetProperty("friends").GetArrayLength());
    }
}
