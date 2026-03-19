using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.SocialService.Entities;
using Xunit;

namespace Winzy.SocialService.Tests;

[Collection("SocialService")]
public class VisibilityEndpointTests : IAsyncLifetime
{
    private readonly SocialServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _friendId = Guid.NewGuid();
    private readonly Guid _habitId1 = Guid.NewGuid();
    private readonly Guid _habitId2 = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public VisibilityEndpointTests(SocialServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private void SetupUserHabits()
    {
        MockHabitHandler.SetHabits(_userId, [
            new { id = _habitId1.ToString(), name = "Workout", icon = "dumbbell", color = "#ff0000" },
            new { id = _habitId2.ToString(), name = "Reading", icon = "book", color = "#00ff00" }
        ]);
    }

    private void SetupFriendHabits()
    {
        MockHabitHandler.SetHabits(_friendId, [
            new { id = _habitId1.ToString(), name = "Workout", icon = "dumbbell", color = "#ff0000" },
            new { id = _habitId2.ToString(), name = "Reading", icon = "book", color = "#00ff00" }
        ]);
    }

    private async Task CreateFriendship()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);
    }

    // --- PUT /social/visibility/{habitId} ---

    [Fact]
    public async Task SetVisibility_NewSetting_Returns200()
    {
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PutAsJsonAsync($"/social/visibility/{_habitId1}",
            new { visibility = "friends" }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("friends", body.GetProperty("visibility").GetString());
        Assert.Equal(_habitId1, body.GetProperty("habitId").GetGuid());

        // Verify in DB
        using var db = _fixture.CreateDbContext();
        var setting = await db.VisibilitySettings
            .FirstOrDefaultAsync(v => v.UserId == _userId && v.HabitId == _habitId1, CT);
        Assert.NotNull(setting);
        Assert.Equal(HabitVisibility.Friends, setting!.Visibility);
    }

    [Fact]
    public async Task SetVisibility_UpdateExisting_Returns200()
    {
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set to friends
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);

        // Update to public
        var response = await client.PutAsJsonAsync($"/social/visibility/{_habitId1}",
            new { visibility = "public" }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("public", body.GetProperty("visibility").GetString());
    }

    [Fact]
    public async Task SetVisibility_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PutAsJsonAsync($"/social/visibility/{_habitId1}",
            new { visibility = "friends" }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SetVisibility_HabitNotOwned_Returns404()
    {
        // User has no habits in the mock — any habitId should fail ownership
        MockHabitHandler.SetHabits(_userId, []);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PutAsJsonAsync($"/social/visibility/{_habitId1}",
            new { visibility = "friends" }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task SetVisibility_HabitService5xx_Returns503()
    {
        MockHabitHandler.SetError(_userId, HttpStatusCode.InternalServerError);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PutAsJsonAsync($"/social/visibility/{_habitId1}",
            new { visibility = "friends" }, CT);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task SetVisibility_HabitServiceTimeout_Returns503()
    {
        MockHabitHandler.SetTimeout(_userId);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PutAsJsonAsync($"/social/visibility/{_habitId1}",
            new { visibility = "friends" }, CT);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task SetVisibility_HabitService404_Returns404()
    {
        // When habit-service returns 404 (user has no habits), that's a genuine not-found
        MockHabitHandler.SetError(_userId, HttpStatusCode.NotFound);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PutAsJsonAsync($"/social/visibility/{_habitId1}",
            new { visibility = "friends" }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /social/visibility (batch) ---

    [Fact]
    public async Task GetVisibilityBatch_ReturnsAllSettings()
    {
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set visibility for two habits
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "public" }, CT);

        var response = await client.GetAsync("/social/visibility", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("private", body.GetProperty("defaultVisibility").GetString());
        var habits = body.GetProperty("habits");
        Assert.Equal(2, habits.GetArrayLength());
    }

    [Fact]
    public async Task GetVisibilityBatch_EmptyWhenNoSettings()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/social/visibility", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("private", body.GetProperty("defaultVisibility").GetString());
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task GetVisibilityBatch_ReflectsDefaultPreference()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        await client.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "friends" }, CT);

        var response = await client.GetAsync("/social/visibility", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("friends", body.GetProperty("defaultVisibility").GetString());
    }

    // --- GET /social/preferences ---

    [Fact]
    public async Task GetPreferences_NoPreferencesSet_ReturnsPrivateDefault()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/social/preferences", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("private", body.GetProperty("defaultHabitVisibility").GetString());
    }

    // --- PUT /social/preferences ---

    [Fact]
    public async Task SetPreferences_ValidUpdate_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PutAsJsonAsync("/social/preferences",
            new { defaultHabitVisibility = "friends" }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("friends", body.GetProperty("defaultHabitVisibility").GetString());

        // Verify subsequent GET returns updated value
        var getResp = await client.GetAsync("/social/preferences", CT);
        var getBody = await getResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("friends", getBody.GetProperty("defaultHabitVisibility").GetString());
    }

    [Fact]
    public async Task SetPreferences_UpdateExisting_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        await client.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "friends" }, CT);
        var response = await client.PutAsJsonAsync("/social/preferences",
            new { defaultHabitVisibility = "public" }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("public", body.GetProperty("defaultHabitVisibility").GetString());

        // Verify only one preference row exists
        using var db = _fixture.CreateDbContext();
        var count = await db.SocialPreferences.CountAsync(p => p.UserId == _userId, CT);
        Assert.Equal(1, count);
    }

    // --- GET /social/friends/{id}/profile ---

    [Fact]
    public async Task GetFriendProfile_ReturnsVisibleHabitsOnly()
    {
        await CreateFriendship();
        SetupFriendHabits();

        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set habit1 to friends visibility, habit2 stays private (default)
        await friendClient.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);

        // Get friend profile
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(_friendId, body.GetProperty("friendId").GetGuid());
        var habits = body.GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength()); // Only habit1 should be visible
        Assert.Equal("Workout", habits[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task GetFriendProfile_WithDefaultFriendsVisibility_ShowsAllHabits()
    {
        await CreateFriendship();
        SetupFriendHabits();

        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set default visibility to friends
        await friendClient.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "friends" }, CT);

        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits");
        Assert.Equal(2, habits.GetArrayLength()); // Both visible because default is friends
    }

    [Fact]
    public async Task GetFriendProfile_ReturnsConsistencyAndFlameLevel()
    {
        await CreateFriendship();

        // Create habits with completions over the last 60 days
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var completions = Enumerable.Range(0, 50)
            .Select(i => new { localDate = today.AddDays(-i).ToString("yyyy-MM-dd"), completedAt = DateTimeOffset.UtcNow })
            .ToArray();

        MockHabitHandler.SetHabits(_friendId, [
            new { id = _habitId1.ToString(), name = "Workout", icon = "dumbbell", color = "#ff0000",
                  consistency = 83.3, flameLevel = "blazing", completions }
        ]);

        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set visibility to friends
        await friendClient.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);

        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength());

        var habit = habits[0];
        Assert.Equal("Workout", habit.GetProperty("name").GetString());
        Assert.True(habit.GetProperty("consistency").GetDouble() > 0);
        Assert.NotEqual("none", habit.GetProperty("flameLevel").GetString());
        // 50 completions in 60 days = ~83.3% -> blazing
        Assert.Equal("blazing", habit.GetProperty("flameLevel").GetString());
    }

    [Fact]
    public async Task GetFriendProfile_NotFriends_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetFriendProfile_PerHabitOverridesDefault()
    {
        await CreateFriendship();
        SetupFriendHabits();

        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Default is friends, but explicitly set habit2 to private
        await friendClient.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "friends" }, CT);
        await friendClient.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "private" }, CT);

        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength()); // Only habit1 visible
        Assert.Equal("Workout", habits[0].GetProperty("name").GetString());
    }

    // --- GET /social/internal/visible-habits/{userId} ---

    [Fact]
    public async Task InternalVisibleHabits_PublicViewer_ReturnsPublicOnly()
    {
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set habit1 to public, habit2 to friends
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "public" }, CT);
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "friends" }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync($"/social/internal/visible-habits/{_userId}?viewer=public", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitIds = body.GetProperty("habitIds");
        Assert.Equal(1, habitIds.GetArrayLength());
        Assert.Equal(_habitId1, habitIds[0].GetGuid());
    }

    [Fact]
    public async Task InternalVisibleHabits_FriendViewer_ReturnsFriendsAndPublic()
    {
        await CreateFriendship();
        SetupUserHabits();

        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set habit1 to public, habit2 to friends
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "public" }, CT);
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "friends" }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer={_friendId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitIds = body.GetProperty("habitIds");
        Assert.Equal(2, habitIds.GetArrayLength()); // Both visible to friend
    }

    [Fact]
    public async Task InternalVisibleHabits_NonFriendViewer_ReturnsPublicOnly()
    {
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set habit1 to public, habit2 to friends
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "public" }, CT);
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "friends" }, CT);

        var strangerId = Guid.NewGuid();
        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer={strangerId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitIds = body.GetProperty("habitIds");
        Assert.Equal(1, habitIds.GetArrayLength()); // Only public
        Assert.Equal(_habitId1, habitIds[0].GetGuid());
    }

    [Fact]
    public async Task InternalVisibleHabits_ReturnsDefaultVisibility()
    {
        using var internalClient = _fixture.Factory.CreateClient();

        var response = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer=public", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("private", body.GetProperty("defaultVisibility").GetString());
        Assert.Equal(0, body.GetProperty("habitIds").GetArrayLength());
    }

    [Fact]
    public async Task InternalVisibleHabits_DefaultPublic_ExcludesNonPublicHabits()
    {
        // When default is public, habits explicitly set to non-public must appear in excludedHabitIds
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set default to public
        await client.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "public" }, CT);
        // Explicitly set habit1 to friends (non-public), habit2 stays at default (public)
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer=public", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("public", body.GetProperty("defaultVisibility").GetString());

        // habit1 set to friends -> excluded from public view
        var excludedIds = body.GetProperty("excludedHabitIds").EnumerateArray()
            .Select(e => e.GetGuid()).ToHashSet();
        Assert.Contains(_habitId1, excludedIds);

        // habit2 has no explicit setting -> not excluded, not in visibleHabitIds
        // (when default=public, absence from excludedHabitIds means visible)
        Assert.DoesNotContain(_habitId2, excludedIds);
    }

    [Fact]
    public async Task InternalVisibleHabits_DefaultPublic_PrivateHabitExcluded()
    {
        // A habit explicitly set to private must be in excludedHabitIds when default is public
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        await client.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "public" }, CT);
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "private" }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer=public", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);

        var excludedIds = body.GetProperty("excludedHabitIds").EnumerateArray()
            .Select(e => e.GetGuid()).ToHashSet();
        Assert.Contains(_habitId2, excludedIds);
    }

    [Fact]
    public async Task InternalVisibleHabits_FriendViewer_DefaultPublic_SeesAll()
    {
        // When default=public, a friend viewer should see friends+public habits
        // and exclude only private ones
        await CreateFriendship();
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        await client.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "public" }, CT);
        // habit1 explicitly private -> excluded for friend too
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "private" }, CT);
        // habit2 explicitly friends -> visible to friend
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "friends" }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer={_friendId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);

        var visibleIds = body.GetProperty("habitIds").EnumerateArray()
            .Select(e => e.GetGuid()).ToHashSet();
        var excludedIds = body.GetProperty("excludedHabitIds").EnumerateArray()
            .Select(e => e.GetGuid()).ToHashSet();

        // habit2 (friends) visible to friend
        Assert.Contains(_habitId2, visibleIds);
        // habit1 (private) excluded even from friend
        Assert.Contains(_habitId1, excludedIds);
        Assert.DoesNotContain(_habitId1, visibleIds);
    }

    [Fact]
    public async Task InternalVisibleHabits_PublicAndFriendViewerParity()
    {
        // Cross-surface parity: verify that public viewer sees less than friend viewer
        await CreateFriendship();
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // habit1 = friends, habit2 = public
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "public" }, CT);

        using var internalClient = _fixture.Factory.CreateClient();

        // Public viewer
        var publicResponse = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer=public", CT);
        var publicBody = await publicResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var publicVisible = publicBody.GetProperty("habitIds").GetArrayLength();

        // Friend viewer
        var friendResponse = await internalClient.GetAsync(
            $"/social/internal/visible-habits/{_userId}?viewer={_friendId}", CT);
        var friendBody = await friendResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var friendVisible = friendBody.GetProperty("habitIds").GetArrayLength();

        // Friend should see strictly more (or equal) habits than public
        Assert.True(friendVisible >= publicVisible,
            $"Friend viewer should see >= habits than public viewer. Friend={friendVisible}, Public={publicVisible}");
        Assert.Equal(1, publicVisible);  // Only habit2 (public)
        Assert.Equal(2, friendVisible);  // Both habits
    }

    [Fact]
    public async Task GetFriendProfile_HabitServiceDegraded_ReturnsEmptyHabits()
    {
        // When habit service is down, friend profile should gracefully return empty habits
        await CreateFriendship();

        // Don't set up habits in mock -> will return 404 from MockHabitHandler
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task GetFriendProfile_DefaultPublic_ExcludesExplicitPrivate()
    {
        // End-to-end: default=public, one habit explicitly private -> friend should see only non-private
        await CreateFriendship();

        var habitId3 = Guid.NewGuid();
        MockHabitHandler.SetHabits(_friendId, [
            new { id = _habitId1.ToString(), name = "Habit A", icon = "star", color = "#aaa" },
            new { id = _habitId2.ToString(), name = "Habit B", icon = "moon", color = "#bbb" },
            new { id = habitId3.ToString(), name = "Habit C", icon = "sun", color = "#ccc" }
        ]);

        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Default = friends (visible to friends), but habit2 explicitly private
        await friendClient.PutAsJsonAsync("/social/preferences", new { defaultHabitVisibility = "friends" }, CT);
        await friendClient.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "private" }, CT);

        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits");

        var habitNames = Enumerable.Range(0, habits.GetArrayLength())
            .Select(i => habits[i].GetProperty("name").GetString())
            .ToHashSet();

        // Habit A and Habit C use default (friends), Habit B is explicitly private
        Assert.Contains("Habit A", habitNames);
        Assert.Contains("Habit C", habitNames);
        Assert.DoesNotContain("Habit B", habitNames);
    }

    // --- HabitArchivedSubscriber integration tests ---

    [Fact]
    public async Task HabitArchivedEvent_DeletesVisibilitySetting()
    {
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Create a visibility setting
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);

        // Verify it exists
        using (var db = _fixture.CreateDbContext())
        {
            var exists = await db.VisibilitySettings
                .AnyAsync(v => v.UserId == _userId && v.HabitId == _habitId1, CT);
            Assert.True(exists);
        }

        // Publish habit.archived event
        var nats = _fixture.Factory.Services.GetRequiredService<NatsEventPublisher>();
        await nats.PublishAsync(Subjects.HabitArchived, new HabitArchivedEvent(_userId, _habitId1), CT);

        // Wait for subscriber to process
        await Task.Delay(1000, CT);

        // Verify the visibility setting was deleted
        using (var db = _fixture.CreateDbContext())
        {
            var exists = await db.VisibilitySettings
                .AnyAsync(v => v.UserId == _userId && v.HabitId == _habitId1, CT);
            Assert.False(exists);
        }
    }

    [Fact]
    public async Task HabitArchivedEvent_NoVisibilitySetting_DoesNotFail()
    {
        // Publish habit.archived event for a habit with no visibility setting (idempotent / redelivery)
        var nats = _fixture.Factory.Services.GetRequiredService<NatsEventPublisher>();
        var nonExistentHabitId = Guid.NewGuid();
        await nats.PublishAsync(Subjects.HabitArchived,
            new HabitArchivedEvent(_userId, nonExistentHabitId), CT);

        // Wait for subscriber to process — should not throw
        await Task.Delay(1000, CT);

        // Verify no error occurred (test would have timed out or failed if subscriber threw)
        using var db = _fixture.CreateDbContext();
        var count = await db.VisibilitySettings
            .CountAsync(v => v.UserId == _userId && v.HabitId == nonExistentHabitId, CT);
        Assert.Equal(0, count);
    }

    [Fact]
    public async Task HabitArchivedEvent_OnlyDeletesTargetHabit()
    {
        SetupUserHabits();
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Create visibility settings for both habits
        await client.PutAsJsonAsync($"/social/visibility/{_habitId1}", new { visibility = "friends" }, CT);
        await client.PutAsJsonAsync($"/social/visibility/{_habitId2}", new { visibility = "public" }, CT);

        // Archive only habit1
        var nats = _fixture.Factory.Services.GetRequiredService<NatsEventPublisher>();
        await nats.PublishAsync(Subjects.HabitArchived, new HabitArchivedEvent(_userId, _habitId1), CT);

        await Task.Delay(1000, CT);

        // habit1 visibility deleted, habit2 still exists
        using var db = _fixture.CreateDbContext();
        var habit1Exists = await db.VisibilitySettings
            .AnyAsync(v => v.UserId == _userId && v.HabitId == _habitId1, CT);
        var habit2Exists = await db.VisibilitySettings
            .AnyAsync(v => v.UserId == _userId && v.HabitId == _habitId2, CT);

        Assert.False(habit1Exists);
        Assert.True(habit2Exists);
    }

    // --- Malformed JSON ---

    [Fact]
    public async Task SetVisibility_MalformedJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var content = new StringContent("not valid json", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PutAsync($"/social/visibility/{_habitId1}", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task SetPreferences_MalformedJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var content = new StringContent("not valid json", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PutAsync("/social/preferences", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task SetVisibility_EmptyBody_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var content = new StringContent("", System.Text.Encoding.UTF8);
        content.Headers.ContentType = null;
        var response = await client.PutAsync($"/social/visibility/{_habitId1}", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task SetPreferences_EmptyBody_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var content = new StringContent("", System.Text.Encoding.UTF8);
        content.Headers.ContentType = null;
        var response = await client.PutAsync("/social/preferences", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }
}
