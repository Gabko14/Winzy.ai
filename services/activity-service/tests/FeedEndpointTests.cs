using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.ActivityService.Entities;
using Xunit;

namespace Winzy.ActivityService.Tests;

[Collection("ActivityService")]
public class FeedEndpointTests : IAsyncLifetime
{
    private readonly ActivityServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _friendId = Guid.NewGuid();
    private readonly Guid _strangerId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public FeedEndpointTests(ActivityServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync()
    {
        await _fixture.ResetDataAsync();
        MockSocialHandler.SetFriends(_userId, _friendId);
        MockSocialHandler.SetFriends(_friendId, _userId);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- GET /activity/feed ---

    [Fact]
    public async Task GetFeed_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetFeed_EmptyFeed_ReturnsEmptyItems()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
        Assert.False(body.GetProperty("hasMore").GetBoolean());
        Assert.True(body.GetProperty("nextCursor").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task GetFeed_ShowsOwnEntries()
    {
        // Seed a feed entry for the user
        await SeedFeedEntry(_userId, "habit.created", new { habitId = Guid.NewGuid(), name = "Meditate" });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal("habit.created", items[0].GetProperty("eventType").GetString());
    }

    [Fact]
    public async Task GetFeed_ShowsFriendEntries()
    {
        var habitId = Guid.NewGuid();
        MockSocialHandler.SetVisibleHabits(_friendId, _userId, habitId);
        await SeedFeedEntry(_friendId, "habit.completed", new { habitId });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal(_friendId, items[0].GetProperty("actorId").GetGuid());
    }

    [Fact]
    public async Task GetFeed_ExcludesStrangerEntries()
    {
        var friendHabitId = Guid.NewGuid();
        MockSocialHandler.SetVisibleHabits(_friendId, _userId, friendHabitId);
        await SeedFeedEntry(_strangerId, "habit.created", new { habitId = Guid.NewGuid(), name = "Run" });
        await SeedFeedEntry(_friendId, "habit.completed", new { habitId = friendHabitId });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        // Only the friend's entry should appear
        Assert.Equal(_friendId, items[0].GetProperty("actorId").GetGuid());
    }

    [Fact]
    public async Task GetFeed_CursorPagination_ReturnsCorrectPages()
    {
        // Seed 5 entries for the user with staggered timestamps
        for (var i = 0; i < 5; i++)
        {
            await SeedFeedEntry(_userId, "habit.completed", new { index = i },
                DateTimeOffset.UtcNow.AddMinutes(-10 + i));
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Page 1: limit=3
        var response1 = await client.GetAsync("/activity/feed?limit=3", CT);
        Assert.Equal(HttpStatusCode.OK, response1.StatusCode);
        var body1 = await response1.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items1 = body1.GetProperty("items");
        Assert.Equal(3, items1.GetArrayLength());
        Assert.True(body1.GetProperty("hasMore").GetBoolean());
        var nextCursor = body1.GetProperty("nextCursor").GetString();
        Assert.NotNull(nextCursor);

        // Page 2: use cursor
        var response2 = await client.GetAsync($"/activity/feed?limit=3&cursor={Uri.EscapeDataString(nextCursor!)}", CT);
        Assert.Equal(HttpStatusCode.OK, response2.StatusCode);
        var body2 = await response2.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items2 = body2.GetProperty("items");
        Assert.Equal(2, items2.GetArrayLength());
        Assert.False(body2.GetProperty("hasMore").GetBoolean());
    }

    [Fact]
    public async Task GetFeed_OrderedByCreatedAtDescending()
    {
        var older = DateTimeOffset.UtcNow.AddMinutes(-10);
        var newer = DateTimeOffset.UtcNow.AddMinutes(-1);

        await SeedFeedEntry(_userId, "habit.created", new { name = "Older" }, older);
        await SeedFeedEntry(_userId, "habit.completed", new { name = "Newer" }, newer);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());
        // Newer first
        Assert.Equal("habit.completed", items[0].GetProperty("eventType").GetString());
        Assert.Equal("habit.created", items[1].GetProperty("eventType").GetString());
    }

    [Fact]
    public async Task GetFeed_InvalidLimit_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/activity/feed?limit=-1", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetFeed_InvalidCursor_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/activity/feed?cursor=not-a-date", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetFeed_LimitCappedAt100()
    {
        // Even if we ask for 200, limit should be capped at 100
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/activity/feed?limit=200", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // Just check it doesn't error — the cap is internal
    }

    // --- Visibility filtering ---

    [Fact]
    public async Task GetFeed_HidesFriendPrivateHabitEvents()
    {
        var visibleHabitId = Guid.NewGuid();
        var privateHabitId = Guid.NewGuid();

        // Friend has one visible habit and one private habit
        MockSocialHandler.SetVisibleHabits(_friendId, _userId, visibleHabitId);

        await SeedFeedEntry(_friendId, "habit.created", new { habitId = visibleHabitId, name = "Visible" });
        await SeedFeedEntry(_friendId, "habit.created", new { habitId = privateHabitId, name = "Private" });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());

        var data = items[0].GetProperty("data");
        Assert.Equal(visibleHabitId, data.GetProperty("habitId").GetGuid());
    }

    [Fact]
    public async Task GetFeed_OwnHabitEventsAlwaysVisible()
    {
        var habitId = Guid.NewGuid();
        // Do NOT set visibility for the user's own habits — they should always show
        await SeedFeedEntry(_userId, "habit.completed", new { habitId, consistency = 0.9 });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
    }

    [Fact]
    public async Task GetFeed_DefaultPublicVisibility_ShowsAllExceptExcluded()
    {
        var visibleHabitId = Guid.NewGuid();
        var excludedHabitId = Guid.NewGuid();
        var unsetHabitId = Guid.NewGuid(); // No explicit setting — should show when default=public

        // Friend has default=public, one habit explicitly excluded
        MockSocialHandler.SetVisibleHabitsWithDefault(
            _friendId, _userId, "public",
            visibleHabitIds: [visibleHabitId],
            excludedHabitIds: [excludedHabitId]);

        await SeedFeedEntry(_friendId, "habit.completed", new { habitId = visibleHabitId });
        await SeedFeedEntry(_friendId, "habit.completed", new { habitId = excludedHabitId });
        await SeedFeedEntry(_friendId, "habit.created", new { habitId = unsetHabitId, name = "Unset" });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        // visibleHabitId and unsetHabitId should show, excludedHabitId should not
        Assert.Equal(2, items.GetArrayLength());

        var habitIds = Enumerable.Range(0, items.GetArrayLength())
            .Select(i => items[i].GetProperty("data").GetProperty("habitId").GetGuid())
            .ToHashSet();
        Assert.Contains(visibleHabitId, habitIds);
        Assert.Contains(unsetHabitId, habitIds);
        Assert.DoesNotContain(excludedHabitId, habitIds);
    }

    [Fact]
    public async Task GetFeed_DefaultPrivateVisibility_ShowsOnlyExplicitlyVisible()
    {
        var visibleHabitId = Guid.NewGuid();
        var unsetHabitId = Guid.NewGuid(); // No explicit setting — should NOT show when default=private

        MockSocialHandler.SetVisibleHabitsWithDefault(
            _friendId, _userId, "private",
            visibleHabitIds: [visibleHabitId]);

        await SeedFeedEntry(_friendId, "habit.completed", new { habitId = visibleHabitId });
        await SeedFeedEntry(_friendId, "habit.created", new { habitId = unsetHabitId, name = "Unset" });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal(visibleHabitId, items[0].GetProperty("data").GetProperty("habitId").GetGuid());
    }

    [Fact]
    public async Task GetFeed_NonHabitEventsNotFilteredByVisibility()
    {
        // Friend's non-habit events should always show regardless of visibility settings
        await SeedFeedEntry(_friendId, "friend.request.accepted", new { userId1 = _friendId, userId2 = _userId });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task GetFeed_MalformedDataInEntry_DoesNotCrashFeed()
    {
        var validHabitId = Guid.NewGuid();
        MockSocialHandler.SetVisibleHabits(_friendId, _userId, validHabitId);

        // Seed a valid entry and one with data that has no habitId (simulates malformed/unexpected shape)
        await SeedFeedEntry(_friendId, "habit.completed", new { habitId = validHabitId });
        await SeedFeedEntry(_friendId, "habit.completed", new { unexpected = "no-habit-id-here" });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        // Feed should return 200, not 500 — malformed entry is skipped
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        // Only the valid entry should appear
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal(validHabitId, items[0].GetProperty("data").GetProperty("habitId").GetGuid());
    }

    // --- Actor display names ---

    [Fact]
    public async Task GetFeed_ReturnsActorNamesFromAuthService()
    {
        // Set up auth profiles for the batch lookup
        MockAuthHandler.SetProfile(_userId, "testuser", "Test User");
        MockAuthHandler.SetProfile(_friendId, "frienduser", "Friend Name");

        var habitId = Guid.NewGuid();
        MockSocialHandler.SetVisibleHabits(_friendId, _userId, habitId);
        await SeedFeedEntry(_userId, "habit.created", new { habitId = Guid.NewGuid(), name = "Read" });
        await SeedFeedEntry(_friendId, "habit.completed", new { habitId });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());

        // Both entries should have actor names enriched
        for (var i = 0; i < items.GetArrayLength(); i++)
        {
            var item = items[i];
            Assert.True(item.TryGetProperty("actorUsername", out var username));
            Assert.NotNull(username.GetString());
            Assert.NotEqual(JsonValueKind.Null, username.ValueKind);
        }
    }

    [Fact]
    public async Task GetFeed_ReturnsStoredActorName_WhenDenormalized()
    {
        // Seed an entry that already has the actor name (e.g. from UserRegisteredSubscriber)
        using (var db = _fixture.CreateDbContext())
        {
            var entry = new FeedEntry
            {
                ActorId = _userId,
                ActorUsername = "storeduser",
                ActorDisplayName = "Stored Display",
                EventType = "user.registered",
                Data = JsonDocument.Parse(JsonSerializer.Serialize(new { userId = _userId, username = "storeduser" }))
            };
            db.FeedEntries.Add(entry);
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal("storeduser", items[0].GetProperty("actorUsername").GetString());
        Assert.Equal("Stored Display", items[0].GetProperty("actorDisplayName").GetString());
    }

    [Fact]
    public async Task GetFeed_GracefullyHandlesAuthServiceDown()
    {
        // Don't set any profiles — MockAuthHandler will return profiles for known IDs only.
        // Since we haven't registered these user IDs, the batch will return empty.
        await SeedFeedEntry(_userId, "habit.created", new { habitId = Guid.NewGuid(), name = "Yoga" });

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        // Should still return 200 with entries, just without actor names
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        // actorUsername should be present in JSON (as null)
        Assert.True(items[0].TryGetProperty("actorUsername", out _));
    }

    // --- Idempotency (no DB writes from GET) ---

    [Fact]
    public async Task GetFeed_DoesNotWriteActorNamesToDb()
    {
        // Seed an entry with null ActorUsername (simulates old data before denormalization)
        await SeedFeedEntry(_userId, "habit.created", new { habitId = Guid.NewGuid(), name = "Read" });

        // Set up auth profiles so the endpoint CAN resolve names in-memory
        MockAuthHandler.SetProfile(_userId, "testuser", "Test User");

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/activity/feed", CT);

        // The response should have the enriched actor name
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal("testuser", items[0].GetProperty("actorUsername").GetString());

        // But the DB row should still have null ActorUsername (no write-through)
        using var db = _fixture.CreateDbContext();
        var dbEntry = await db.FeedEntries.FirstAsync(CT);
        Assert.Null(dbEntry.ActorUsername);
        Assert.Null(dbEntry.ActorDisplayName);
    }

    // --- GET /health ---

    [Fact]
    public async Task Health_ReturnsHealthy()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.GetAsync("/health", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(CT);
        Assert.Contains("Healthy", body);
    }

    // --- Helper ---

    private async Task SeedFeedEntry(Guid actorId, string eventType, object data, DateTimeOffset? createdAt = null)
    {
        using var db = _fixture.CreateDbContext();
        var entry = new FeedEntry
        {
            ActorId = actorId,
            EventType = eventType,
            Data = JsonDocument.Parse(JsonSerializer.Serialize(data))
        };

        db.FeedEntries.Add(entry);
        await db.SaveChangesAsync(CT);

        // Override CreatedAt if specified (BaseEntity sets it on SaveChanges)
        if (createdAt.HasValue)
        {
            entry.CreatedAt = createdAt.Value;
            entry.UpdatedAt = createdAt.Value;
            await db.SaveChangesAsync(CT);
        }
    }
}
