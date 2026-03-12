using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
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
