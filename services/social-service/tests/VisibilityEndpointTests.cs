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
}
