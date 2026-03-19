using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.SocialService.Entities;
using Xunit;

namespace Winzy.SocialService.Tests;

[Collection("SocialService")]
public class FriendshipEndpointTests : IAsyncLifetime
{
    private readonly SocialServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _friendId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public FriendshipEndpointTests(SocialServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- POST /social/friends/request ---

    [Fact]
    public async Task SendFriendRequest_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(_userId, body.GetProperty("userId").GetGuid());
        Assert.Equal(_friendId, body.GetProperty("friendId").GetGuid());
        Assert.Equal("pending", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task SendFriendRequest_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SendFriendRequest_ToSelf_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _userId }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Cannot send friend request to yourself", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task SendFriendRequest_EmptyFriendId_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/social/friends/request", new { friendId = Guid.Empty }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SendFriendRequest_Duplicate_Returns409()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var response = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Friend request already exists", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task SendFriendRequest_AlreadyFriends_Returns409()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        // Send and accept
        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        // Try again
        var response = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Already friends", body.GetProperty("error").GetString());
    }

    // --- PUT /social/friends/request/{id}/accept ---

    [Fact]
    public async Task AcceptFriendRequest_ValidRequest_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();

        var response = await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("accepted", body.GetProperty("status").GetString());

        // Verify bidirectional — both users should have a friendship
        using var db = _fixture.CreateDbContext();
        var forwardExists = await db.Friendships.AnyAsync(
            f => f.UserId == _userId && f.FriendId == _friendId && f.Status == FriendshipStatus.Accepted, CT);
        var reverseExists = await db.Friendships.AnyAsync(
            f => f.UserId == _friendId && f.FriendId == _userId && f.Status == FriendshipStatus.Accepted, CT);
        Assert.True(forwardExists);
        Assert.True(reverseExists);
    }

    [Fact]
    public async Task AcceptFriendRequest_WrongUser_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();

        // Sender tries to accept their own request
        var response = await client.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AcceptFriendRequest_NonExistent_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_friendId);

        var response = await client.PutAsJsonAsync($"/social/friends/request/{Guid.NewGuid()}/accept", new { }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- PUT /social/friends/request/{id}/decline ---

    [Fact]
    public async Task DeclineFriendRequest_ValidRequest_Returns204()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();

        var response = await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/decline", new { }, CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Verify deleted from DB
        using var db = _fixture.CreateDbContext();
        var exists = await db.Friendships.AnyAsync(f => f.Id == requestId, CT);
        Assert.False(exists);
    }

    [Fact]
    public async Task DeclineFriendRequest_SenderCannotDecline_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();

        // Sender tries to decline their own request
        var response = await client.PutAsJsonAsync($"/social/friends/request/{requestId}/decline", new { }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- DELETE /social/friends/{friendId} ---

    [Fact]
    public async Task RemoveFriend_ValidFriendship_Returns204()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        // Create friendship
        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        // Remove
        var response = await client.DeleteAsync($"/social/friends/{_friendId}", CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Verify both directions removed
        using var db = _fixture.CreateDbContext();
        var remaining = await db.Friendships.CountAsync(
            f => (f.UserId == _userId && f.FriendId == _friendId) ||
                 (f.UserId == _friendId && f.FriendId == _userId), CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task RemoveFriend_NotFriends_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.DeleteAsync($"/social/friends/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /social/friends ---

    [Fact]
    public async Task ListFriends_ReturnsPaginatedFriends()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        // Create friendship
        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        var response = await client.GetAsync("/social/friends", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("total").GetInt32());
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal(_friendId, items[0].GetProperty("friendId").GetGuid());
    }

    [Fact]
    public async Task ListFriends_EnrichesWithProfileData()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        MockAuthHandler.SetProfile(_friendId, "alice", "Alice Wonderland");

        // Create friendship
        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        var response = await client.GetAsync("/social/friends", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var item = body.GetProperty("items")[0];
        Assert.Equal("alice", item.GetProperty("username").GetString());
        Assert.Equal("Alice Wonderland", item.GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task ListFriends_GracefulDegradation_WhenProfilesNotFound()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        // Don't set any profiles — auth service returns empty
        // Create friendship
        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        var response = await client.GetAsync("/social/friends", CT);

        // Should still return friend data, just without enriched profile
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("total").GetInt32());
        var item = body.GetProperty("items")[0];
        Assert.Equal(_friendId, item.GetProperty("friendId").GetGuid());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("username").ValueKind);
    }

    [Fact]
    public async Task ListFriends_Empty_ReturnsEmptyList()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/social/friends", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("total").GetInt32());
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ListFriends_PendingRequestNotIncluded()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Send a request but don't accept it
        await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        var response = await client.GetAsync("/social/friends", CT);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("total").GetInt32());
    }

    // --- GET /social/friends — flame enrichment (winzy.ai-3r2.5) ---

    [Fact]
    public async Task ListFriends_EnrichesWithFlameData()
    {
        await CreateFriendship();

        // Friend has a habit with flame data — set visibility to friends
        var habitId = Guid.NewGuid();
        MockHabitHandler.SetHabits(_friendId, [
            new { id = habitId, name = "Meditate", icon = (string?)null, color = (string?)null, consistency = 75.0, flameLevel = "strong" }
        ]);

        // Set habit visibility to friends so it's visible
        using var db = _fixture.CreateDbContext();
        db.VisibilitySettings.Add(new VisibilitySetting
        {
            UserId = _friendId,
            HabitId = habitId,
            Visibility = HabitVisibility.Friends
        });
        await db.SaveChangesAsync(CT);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/social/friends", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var item = body.GetProperty("items")[0];
        Assert.Equal("strong", item.GetProperty("flameLevel").GetString());
        Assert.Equal(75.0, item.GetProperty("consistency").GetDouble());
        Assert.False(item.GetProperty("habitsUnavailable").GetBoolean());
    }

    [Fact]
    public async Task ListFriends_FlameAggregation_UsesHighestFlameLevel()
    {
        await CreateFriendship();

        var habitId1 = Guid.NewGuid();
        var habitId2 = Guid.NewGuid();
        MockHabitHandler.SetHabits(_friendId, [
            new { id = habitId1, name = "Read", icon = (string?)null, color = (string?)null, consistency = 30.0, flameLevel = "ember" },
            new { id = habitId2, name = "Meditate", icon = (string?)null, color = (string?)null, consistency = 80.0, flameLevel = "blazing" }
        ]);

        using var db = _fixture.CreateDbContext();
        db.VisibilitySettings.AddRange(
            new VisibilitySetting { UserId = _friendId, HabitId = habitId1, Visibility = HabitVisibility.Friends },
            new VisibilitySetting { UserId = _friendId, HabitId = habitId2, Visibility = HabitVisibility.Friends }
        );
        await db.SaveChangesAsync(CT);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/social/friends", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var item = body.GetProperty("items")[0];
        Assert.Equal("blazing", item.GetProperty("flameLevel").GetString());
        Assert.Equal(55.0, item.GetProperty("consistency").GetDouble()); // average of 30 + 80
    }

    [Fact]
    public async Task ListFriends_FlameRespectsVisibility_PrivateHabitsExcluded()
    {
        await CreateFriendship();

        var publicHabitId = Guid.NewGuid();
        var privateHabitId = Guid.NewGuid();
        MockHabitHandler.SetHabits(_friendId, [
            new { id = publicHabitId, name = "Visible", icon = (string?)null, color = (string?)null, consistency = 40.0, flameLevel = "steady" },
            new { id = privateHabitId, name = "Secret", icon = (string?)null, color = (string?)null, consistency = 95.0, flameLevel = "blazing" }
        ]);

        using var db = _fixture.CreateDbContext();
        db.VisibilitySettings.AddRange(
            new VisibilitySetting { UserId = _friendId, HabitId = publicHabitId, Visibility = HabitVisibility.Friends },
            new VisibilitySetting { UserId = _friendId, HabitId = privateHabitId, Visibility = HabitVisibility.Private }
        );
        await db.SaveChangesAsync(CT);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/social/friends", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var item = body.GetProperty("items")[0];
        // Only the visible habit contributes — "steady" not "blazing"
        Assert.Equal("steady", item.GetProperty("flameLevel").GetString());
        Assert.Equal(40.0, item.GetProperty("consistency").GetDouble());
    }

    [Fact]
    public async Task ListFriends_GracefulDegradation_WhenHabitServiceUnavailable()
    {
        await CreateFriendship();

        MockHabitHandler.SetError(_friendId, HttpStatusCode.InternalServerError);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/social/friends", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var item = body.GetProperty("items")[0];
        Assert.Equal("none", item.GetProperty("flameLevel").GetString());
        Assert.Equal(0.0, item.GetProperty("consistency").GetDouble());
        Assert.True(item.GetProperty("habitsUnavailable").GetBoolean());
    }

    [Fact]
    public async Task ListFriends_NoVisibleHabits_ReturnsNoneFlame()
    {
        await CreateFriendship();

        // Friend has habits but all are private (default visibility is private)
        MockHabitHandler.SetHabits(_friendId, [
            new { id = Guid.NewGuid(), name = "Secret", icon = (string?)null, color = (string?)null, consistency = 90.0, flameLevel = "blazing" }
        ]);
        // No visibility settings → defaults to private

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/social/friends", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var item = body.GetProperty("items")[0];
        Assert.Equal("none", item.GetProperty("flameLevel").GetString());
        Assert.Equal(0.0, item.GetProperty("consistency").GetDouble());
        Assert.False(item.GetProperty("habitsUnavailable").GetBoolean());
    }

    // --- GET /social/friends/requests/count ---

    [Fact]
    public async Task PendingFriendCount_NoPending_ReturnsZero()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/social/friends/requests/count", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task PendingFriendCount_WithIncoming_ReturnsCount()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        // _userId sends request to _friendId — incoming for _friendId
        await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        var response = await friendClient.GetAsync("/social/friends/requests/count", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task PendingFriendCount_OutgoingNotCounted()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // _userId sends request — outgoing, should not count
        await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        var response = await client.GetAsync("/social/friends/requests/count", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task PendingFriendCount_AcceptedNotCounted()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        // Send and accept
        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        // After acceptance, count should be 0
        var response = await friendClient.GetAsync("/social/friends/requests/count", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task PendingFriendCount_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.GetAsync("/social/friends/requests/count", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- GET /social/friends/requests ---

    [Fact]
    public async Task ListFriendRequests_ShowsIncomingAndOutgoing()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Send a request (outgoing for _userId)
        await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        var response = await client.GetAsync("/social/friends/requests", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("outgoing").GetArrayLength());
        Assert.Equal(0, body.GetProperty("incoming").GetArrayLength());

        // From friend's perspective it's incoming
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);
        var friendResponse = await friendClient.GetAsync("/social/friends/requests", CT);
        var friendBody = await friendResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, friendBody.GetProperty("outgoing").GetArrayLength());
        Assert.Equal(1, friendBody.GetProperty("incoming").GetArrayLength());
    }

    [Fact]
    public async Task ListFriendRequests_EnrichesWithProfileData()
    {
        MockAuthHandler.SetProfile(_userId, "sender", "Sender Name");
        MockAuthHandler.SetProfile(_friendId, "receiver", "Receiver Name");

        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Send a request
        await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        // Outgoing for sender — should have toUsername/toDisplayName
        var response = await client.GetAsync("/social/friends/requests", CT);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var outgoing = body.GetProperty("outgoing")[0];
        Assert.Equal("receiver", outgoing.GetProperty("toUsername").GetString());
        Assert.Equal("Receiver Name", outgoing.GetProperty("toDisplayName").GetString());

        // Incoming for receiver — should have fromUsername/fromDisplayName
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);
        var friendResponse = await friendClient.GetAsync("/social/friends/requests", CT);
        var friendBody = await friendResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var incoming = friendBody.GetProperty("incoming")[0];
        Assert.Equal("sender", incoming.GetProperty("fromUsername").GetString());
        Assert.Equal("Sender Name", incoming.GetProperty("fromDisplayName").GetString());
    }

    // --- GET /social/internal/friends/{userId1}/{userId2} ---

    [Fact]
    public async Task InternalFriendsCheck_AreFriends_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        // Create friendship
        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);

        // Internal check
        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync($"/social/internal/friends/{_userId}/{_friendId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("areFriends").GetBoolean());
    }

    [Fact]
    public async Task InternalFriendsCheck_NotFriends_Returns404()
    {
        using var internalClient = _fixture.Factory.CreateClient();

        var response = await internalClient.GetAsync($"/social/internal/friends/{_userId}/{_friendId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task InternalFriendsCheck_PendingRequest_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Send request but don't accept
        await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync($"/social/internal/friends/{_userId}/{_friendId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /social/friends/{id}/profile ---

    [Fact]
    public async Task FriendProfile_HappyPath_ReturnsHabitsAndAvailable()
    {
        await CreateFriendship();

        MockHabitHandler.SetHabits(_friendId, [
            new { id = Guid.NewGuid(), name = "Meditate", icon = (string?)null, color = (string?)null, consistency = 75.0, flameLevel = "strong" }
        ]);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(_friendId, body.GetProperty("friendId").GetGuid());
        Assert.False(body.GetProperty("habitsUnavailable").GetBoolean());
    }

    [Fact]
    public async Task FriendProfile_EmptyHabits_ReturnsAvailable()
    {
        await CreateFriendship();

        MockHabitHandler.SetHabits(_friendId, []);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
        Assert.False(body.GetProperty("habitsUnavailable").GetBoolean());
    }

    [Fact]
    public async Task FriendProfile_HabitServiceError_ReturnsUnavailable()
    {
        await CreateFriendship();

        MockHabitHandler.SetError(_friendId, HttpStatusCode.InternalServerError);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
        Assert.True(body.GetProperty("habitsUnavailable").GetBoolean());
    }

    [Fact]
    public async Task FriendProfile_HabitServiceNotFound_ReturnsUnavailable()
    {
        await CreateFriendship();

        // Don't set any habits — MockHabitHandler returns 404 by default

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("habitsUnavailable").GetBoolean());
    }

    [Fact]
    public async Task FriendProfile_HabitServiceMalformedJson_ReturnsUnavailable()
    {
        await CreateFriendship();

        // Habit service returns 200 but with non-array JSON
        MockHabitHandler.SetRawResponse(_friendId, "not valid json");

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
        Assert.True(body.GetProperty("habitsUnavailable").GetBoolean());
    }

    [Fact]
    public async Task FriendProfile_NotFriends_Returns404()
    {
        // Don't create friendship
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/social/friends/{_friendId}/profile", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- Malformed JSON ---

    [Fact]
    public async Task SendFriendRequest_MalformedJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var content = new StringContent("not valid json", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/social/friends/request", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    // --- Helper ---

    private async Task CreateFriendship()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var friendClient = _fixture.CreateAuthenticatedClient(_friendId);

        var sendResp = await client.PostAsJsonAsync("/social/friends/request", new { friendId = _friendId }, CT);
        var sendBody = await sendResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var requestId = sendBody.GetProperty("id").GetGuid();
        await friendClient.PutAsJsonAsync($"/social/friends/request/{requestId}/accept", new { }, CT);
    }
}
