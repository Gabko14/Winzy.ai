using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Winzy.SocialService.Tests;

[Collection("SocialService")]
public class WitnessLinkEndpointTests : IAsyncLifetime
{
    private readonly SocialServiceFixture _fixture;
    private readonly Guid _ownerId = Guid.NewGuid();
    private readonly Guid _habitId1 = Guid.NewGuid();
    private readonly Guid _habitId2 = Guid.NewGuid();
    private readonly Guid _habitId3 = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public WitnessLinkEndpointTests(SocialServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private void SetupOwnerHabits()
    {
        MockHabitHandler.SetHabits(_ownerId, [
            new { id = _habitId1.ToString(), name = "Workout", icon = "dumbbell", color = "#ff0000",
                  consistency = 83.3, flameLevel = "blazing" },
            new { id = _habitId2.ToString(), name = "Reading", icon = "book", color = "#00ff00",
                  consistency = 45.0, flameLevel = "steady" },
            new { id = _habitId3.ToString(), name = "Meditation", icon = "brain", color = "#0000ff",
                  consistency = 10.0, flameLevel = "ember" }
        ]);
        MockAuthHandler.SetProfile(_ownerId, "testowner", "Test Owner");
    }

    private async Task<JsonElement> CreateWitnessLink(
        HttpClient client, string? label = null, List<Guid>? habitIds = null)
    {
        var response = await client.PostAsJsonAsync("/social/witness-links",
            new { label, habitIds }, CT);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>(CT);
    }

    // ========== POST /social/witness-links ==========

    [Fact]
    public async Task CreateWitnessLink_WithLabelAndHabits_Returns201()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var response = await client.PostAsJsonAsync("/social/witness-links",
            new { label = "Maya", habitIds = new[] { _habitId1, _habitId2 } }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);

        Assert.NotEqual(Guid.Empty, body.GetProperty("id").GetGuid());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("token").GetString()));
        Assert.Equal("Maya", body.GetProperty("label").GetString());
        var habitIds = body.GetProperty("habitIds").EnumerateArray()
            .Select(e => e.GetGuid()).ToList();
        Assert.Equal(2, habitIds.Count);
        Assert.Contains(_habitId1, habitIds);
        Assert.Contains(_habitId2, habitIds);
    }

    [Fact]
    public async Task CreateWitnessLink_NoLabel_Returns201WithNullLabel()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var body = await CreateWitnessLink(client);

        Assert.Equal(JsonValueKind.Null, body.GetProperty("label").ValueKind);
    }

    [Fact]
    public async Task CreateWitnessLink_NoHabits_Returns201WithEmptyList()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var body = await CreateWitnessLink(client);

        Assert.Equal(0, body.GetProperty("habitIds").GetArrayLength());
    }

    [Fact]
    public async Task CreateWitnessLink_DuplicateHabitIds_DeduplicatesAutomatically()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var response = await client.PostAsJsonAsync("/social/witness-links",
            new { habitIds = new[] { _habitId1, _habitId1, _habitId1 } }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("habitIds").GetArrayLength());
    }

    [Fact]
    public async Task CreateWitnessLink_LabelTooLong_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var response = await client.PostAsJsonAsync("/social/witness-links",
            new { label = new string('x', 101) }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateWitnessLink_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/social/witness-links",
            new { label = "test" }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateWitnessLink_MalformedJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var content = new StringContent("not valid json", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/social/witness-links", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateWitnessLink_TokenIsHighEntropy()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var body1 = await CreateWitnessLink(client, "Link 1");
        var body2 = await CreateWitnessLink(client, "Link 2");

        var token1 = body1.GetProperty("token").GetString()!;
        var token2 = body2.GetProperty("token").GetString()!;

        // Tokens should be 43 chars (32 bytes base64url without padding)
        Assert.Equal(43, token1.Length);
        Assert.Equal(43, token2.Length);
        Assert.NotEqual(token1, token2);
    }

    // ========== GET /social/witness-links ==========

    [Fact]
    public async Task ListWitnessLinks_ReturnsOwnedLinksOnly()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        await CreateWitnessLink(client, "Link A", [_habitId1]);
        await CreateWitnessLink(client, "Link B", [_habitId2]);

        // Create a link for another user
        var otherUser = Guid.NewGuid();
        using var otherClient = _fixture.CreateAuthenticatedClient(otherUser);
        await CreateWitnessLink(otherClient, "Other link");

        var response = await client.GetAsync("/social/witness-links", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());
    }

    [Fact]
    public async Task ListWitnessLinks_ExcludesRevokedLinks()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Will revoke", [_habitId1]);
        await CreateWitnessLink(client, "Will keep", [_habitId2]);

        // Revoke the first link
        var linkId = created.GetProperty("id").GetGuid();
        await client.DeleteAsync($"/social/witness-links/{linkId}", CT);

        var response = await client.GetAsync("/social/witness-links", CT);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal("Will keep", items[0].GetProperty("label").GetString());
    }

    // ========== PUT /social/witness-links/{id} ==========

    [Fact]
    public async Task UpdateWitnessLink_ChangeLabel_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Old Label", [_habitId1]);
        var linkId = created.GetProperty("id").GetGuid();

        var response = await client.PutAsJsonAsync($"/social/witness-links/{linkId}",
            new { label = "New Label" }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("New Label", body.GetProperty("label").GetString());
        // Habits should remain unchanged
        Assert.Equal(1, body.GetProperty("habitIds").GetArrayLength());
    }

    [Fact]
    public async Task UpdateWitnessLink_ChangeHabits_ReplacesAllowlist()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test", [_habitId1, _habitId2]);
        var linkId = created.GetProperty("id").GetGuid();

        // Replace with just habitId3
        var response = await client.PutAsJsonAsync($"/social/witness-links/{linkId}",
            new { habitIds = new[] { _habitId3 } }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitIds = body.GetProperty("habitIds").EnumerateArray()
            .Select(e => e.GetGuid()).ToList();
        Assert.Single(habitIds);
        Assert.Contains(_habitId3, habitIds);
    }

    [Fact]
    public async Task UpdateWitnessLink_RevokedLink_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test");
        var linkId = created.GetProperty("id").GetGuid();
        await client.DeleteAsync($"/social/witness-links/{linkId}", CT);

        var response = await client.PutAsJsonAsync($"/social/witness-links/{linkId}",
            new { label = "New" }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateWitnessLink_OtherOwner_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Mine");
        var linkId = created.GetProperty("id").GetGuid();

        var otherUser = Guid.NewGuid();
        using var otherClient = _fixture.CreateAuthenticatedClient(otherUser);

        var response = await otherClient.PutAsJsonAsync($"/social/witness-links/{linkId}",
            new { label = "Hacked" }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateWitnessLink_LabelTooLong_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test");
        var linkId = created.GetProperty("id").GetGuid();

        var response = await client.PutAsJsonAsync($"/social/witness-links/{linkId}",
            new { label = new string('x', 101) }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ========== DELETE /social/witness-links/{id} (revoke) ==========

    [Fact]
    public async Task RevokeWitnessLink_Returns204()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test");
        var linkId = created.GetProperty("id").GetGuid();

        var response = await client.DeleteAsync($"/social/witness-links/{linkId}", CT);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Verify soft delete in DB
        using var db = _fixture.CreateDbContext();
        var link = await db.WitnessLinks.FirstOrDefaultAsync(w => w.Id == linkId, CT);
        Assert.NotNull(link);
        Assert.NotNull(link!.RevokedAt);
    }

    [Fact]
    public async Task RevokeWitnessLink_AlreadyRevoked_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test");
        var linkId = created.GetProperty("id").GetGuid();

        await client.DeleteAsync($"/social/witness-links/{linkId}", CT);
        var response = await client.DeleteAsync($"/social/witness-links/{linkId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task RevokeWitnessLink_OtherOwner_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);
        var created = await CreateWitnessLink(client, "Test");
        var linkId = created.GetProperty("id").GetGuid();

        var otherUser = Guid.NewGuid();
        using var otherClient = _fixture.CreateAuthenticatedClient(otherUser);

        var response = await otherClient.DeleteAsync($"/social/witness-links/{linkId}", CT);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ========== POST /social/witness-links/{id}/rotate ==========

    [Fact]
    public async Task RotateToken_GeneratesNewToken()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var linkId = created.GetProperty("id").GetGuid();
        var oldToken = created.GetProperty("token").GetString()!;

        var response = await client.PostAsync($"/social/witness-links/{linkId}/rotate", null, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var newToken = body.GetProperty("token").GetString()!;

        Assert.NotEqual(oldToken, newToken);
        Assert.Equal(43, newToken.Length);
        // Label and habits should be preserved
        Assert.Equal("Test", body.GetProperty("label").GetString());
        Assert.Equal(1, body.GetProperty("habitIds").GetArrayLength());
    }

    [Fact]
    public async Task RotateToken_OldTokenStopsWorking()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);
        using var anonClient = _fixture.Factory.CreateClient();

        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var linkId = created.GetProperty("id").GetGuid();
        var oldToken = created.GetProperty("token").GetString()!;

        // Old token works
        var response1 = await anonClient.GetAsync($"/social/witness/{oldToken}", CT);
        Assert.Equal(HttpStatusCode.OK, response1.StatusCode);

        // Rotate
        var rotateResp = await client.PostAsync($"/social/witness-links/{linkId}/rotate", null, CT);
        var rotateBody = await rotateResp.Content.ReadFromJsonAsync<JsonElement>(CT);
        var newToken = rotateBody.GetProperty("token").GetString()!;

        // Old token no longer works
        var response2 = await anonClient.GetAsync($"/social/witness/{oldToken}", CT);
        Assert.Equal(HttpStatusCode.NotFound, response2.StatusCode);

        // New token works
        var response3 = await anonClient.GetAsync($"/social/witness/{newToken}", CT);
        Assert.Equal(HttpStatusCode.OK, response3.StatusCode);
    }

    [Fact]
    public async Task RotateToken_RevokedLink_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test");
        var linkId = created.GetProperty("id").GetGuid();
        await client.DeleteAsync($"/social/witness-links/{linkId}", CT);

        var response = await client.PostAsync($"/social/witness-links/{linkId}/rotate", null, CT);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ========== GET /social/witness/{token} (anonymous viewer) ==========

    [Fact]
    public async Task WitnessViewer_ShowsOnlySelectedHabits()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        // Create link with only habit1 and habit2 (not habit3)
        var created = await CreateWitnessLink(client, "Maya", [_habitId1, _habitId2]);
        var token = created.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);

        Assert.Equal("testowner", body.GetProperty("ownerUsername").GetString());
        Assert.Equal("Test Owner", body.GetProperty("ownerDisplayName").GetString());
        Assert.False(body.GetProperty("habitsUnavailable").GetBoolean());

        var habits = body.GetProperty("habits");
        Assert.Equal(2, habits.GetArrayLength());

        var habitNames = Enumerable.Range(0, habits.GetArrayLength())
            .Select(i => habits[i].GetProperty("name").GetString())
            .ToHashSet();
        Assert.Contains("Workout", habitNames);
        Assert.Contains("Reading", habitNames);
        Assert.DoesNotContain("Meditation", habitNames);
    }

    [Fact]
    public async Task WitnessViewer_IncludesFlameData()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var token = created.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habit = body.GetProperty("habits")[0];
        Assert.Equal("blazing", habit.GetProperty("flameLevel").GetString());
        Assert.Equal(83.3, habit.GetProperty("consistency").GetDouble());
    }

    [Fact]
    public async Task WitnessViewer_RevokedToken_Returns404()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var token = created.GetProperty("token").GetString()!;
        var linkId = created.GetProperty("id").GetGuid();

        // Revoke
        await client.DeleteAsync($"/social/witness-links/{linkId}", CT);

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task WitnessViewer_InvalidToken_ReturnsSafe404()
    {
        using var anonClient = _fixture.Factory.CreateClient();

        var response = await anonClient.GetAsync("/social/witness/totally-invalid-token-that-does-not-exist", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("This witness link is not available", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task WitnessViewer_MalformedToken_ReturnsSafe404()
    {
        using var anonClient = _fixture.Factory.CreateClient();

        // Too short
        var response1 = await anonClient.GetAsync("/social/witness/abc", CT);
        Assert.Equal(HttpStatusCode.NotFound, response1.StatusCode);

        // Too long (> 64 chars)
        var response2 = await anonClient.GetAsync(
            $"/social/witness/{new string('a', 65)}", CT);
        Assert.Equal(HttpStatusCode.NotFound, response2.StatusCode);
    }

    [Fact]
    public async Task WitnessViewer_SameResponseForRevokedAndUnknown()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        // Create and revoke a link
        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var revokedToken = created.GetProperty("token").GetString()!;
        await client.DeleteAsync($"/social/witness-links/{created.GetProperty("id").GetGuid()}", CT);

        using var anonClient = _fixture.Factory.CreateClient();

        // Response for revoked token
        var revokedResp = await anonClient.GetAsync($"/social/witness/{revokedToken}", CT);
        var revokedBody = await revokedResp.Content.ReadFromJsonAsync<JsonElement>(CT);

        // Response for completely unknown token
        var unknownResp = await anonClient.GetAsync(
            "/social/witness/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0", CT);
        var unknownBody = await unknownResp.Content.ReadFromJsonAsync<JsonElement>(CT);

        // Both should return 404 with identical error message (no info leakage)
        Assert.Equal(HttpStatusCode.NotFound, revokedResp.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknownResp.StatusCode);
        Assert.Equal(
            revokedBody.GetProperty("error").GetString(),
            unknownBody.GetProperty("error").GetString());
    }

    [Fact]
    public async Task WitnessViewer_NoHabitsSelected_ReturnsEmptyHabits()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        // Create link with no habits
        var created = await CreateWitnessLink(client);
        var token = created.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task WitnessViewer_ArchivedHabitDisappearsFromPage()
    {
        // Setup habits where habit3 is "archived" (not returned by habit-service)
        MockHabitHandler.SetHabits(_ownerId, [
            new { id = _habitId1.ToString(), name = "Workout", icon = "dumbbell", color = "#ff0000",
                  consistency = 83.3, flameLevel = "blazing" },
            new { id = _habitId2.ToString(), name = "Reading", icon = "book", color = "#00ff00",
                  consistency = 45.0, flameLevel = "steady" }
            // habit3 not included — simulates archived
        ]);
        MockAuthHandler.SetProfile(_ownerId, "testowner", "Test Owner");

        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        // Create link that includes habit3 (which won't be in habit-service response)
        var created = await CreateWitnessLink(client, "Test", [_habitId1, _habitId2, _habitId3]);
        var token = created.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits");
        // Only 2 habits returned (habit3 is archived so not in habit-service response)
        Assert.Equal(2, habits.GetArrayLength());
    }

    [Fact]
    public async Task WitnessViewer_HabitServiceDown_ReturnsHabitsUnavailable()
    {
        MockHabitHandler.SetError(_ownerId, HttpStatusCode.InternalServerError);
        MockAuthHandler.SetProfile(_ownerId, "testowner", "Test Owner");

        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var token = created.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("habitsUnavailable").GetBoolean());
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task WitnessViewer_HabitServiceTimeout_ReturnsHabitsUnavailable()
    {
        MockHabitHandler.SetTimeout(_ownerId);
        MockAuthHandler.SetProfile(_ownerId, "testowner", "Test Owner");

        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var token = created.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("habitsUnavailable").GetBoolean());
    }

    // ========== Multiple links per owner ==========

    [Fact]
    public async Task MultipleLinks_DifferentHabitSelections()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        // Link for Maya: Workout + Reading
        var link1 = await CreateWitnessLink(client, "Maya", [_habitId1, _habitId2]);
        var token1 = link1.GetProperty("token").GetString()!;

        // Link for Coach: just Workout
        var link2 = await CreateWitnessLink(client, "Coach Sam", [_habitId1]);
        var token2 = link2.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();

        // Maya sees 2 habits
        var resp1 = await anonClient.GetAsync($"/social/witness/{token1}", CT);
        var body1 = await resp1.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(2, body1.GetProperty("habits").GetArrayLength());

        // Coach sees 1 habit
        var resp2 = await anonClient.GetAsync($"/social/witness/{token2}", CT);
        var body2 = await resp2.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body2.GetProperty("habits").GetArrayLength());
    }

    // ========== Habit removed from allowlist ==========

    [Fact]
    public async Task HabitRemovedFromAllowlist_NoLongerAppearsOnWitnessPage()
    {
        SetupOwnerHabits();
        using var client = _fixture.CreateAuthenticatedClient(_ownerId);
        using var anonClient = _fixture.Factory.CreateClient();

        var created = await CreateWitnessLink(client, "Test", [_habitId1, _habitId2]);
        var linkId = created.GetProperty("id").GetGuid();
        var token = created.GetProperty("token").GetString()!;

        // Initially 2 habits visible
        var resp1 = await anonClient.GetAsync($"/social/witness/{token}", CT);
        var body1 = await resp1.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(2, body1.GetProperty("habits").GetArrayLength());

        // Remove habit2 from allowlist
        await client.PutAsJsonAsync($"/social/witness-links/{linkId}",
            new { habitIds = new[] { _habitId1 } }, CT);

        // Now only 1 habit visible
        var resp2 = await anonClient.GetAsync($"/social/witness/{token}", CT);
        var body2 = await resp2.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body2.GetProperty("habits").GetArrayLength());
        Assert.Equal("Workout", body2.GetProperty("habits")[0].GetProperty("name").GetString());
    }

    // ========== Auth profile degradation ==========

    [Fact]
    public async Task WitnessViewer_AuthServiceDown_StillReturnsHabits()
    {
        MockHabitHandler.SetHabits(_ownerId, [
            new { id = _habitId1.ToString(), name = "Workout", icon = "dumbbell", color = "#ff0000",
                  consistency = 83.3, flameLevel = "blazing" }
        ]);
        // Don't set up auth profile — MockAuthHandler returns 404 for unknown users

        using var client = _fixture.CreateAuthenticatedClient(_ownerId);

        var created = await CreateWitnessLink(client, "Test", [_habitId1]);
        var token = created.GetProperty("token").GetString()!;

        using var anonClient = _fixture.Factory.CreateClient();
        var response = await anonClient.GetAsync($"/social/witness/{token}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        // Habits should still be present even if profile fetch fails
        Assert.Equal(1, body.GetProperty("habits").GetArrayLength());
        // Owner info may be null
        Assert.Equal(JsonValueKind.Null, body.GetProperty("ownerUsername").ValueKind);
    }
}
