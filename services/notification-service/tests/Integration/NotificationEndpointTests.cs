using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.NotificationService.Entities;
using Winzy.NotificationService.Tests.Fixtures;
using Xunit;

namespace Winzy.NotificationService.Tests.Integration;

public class NotificationEndpointTests : IClassFixture<NotificationServiceFixture>, IAsyncLifetime
{
    private readonly NotificationServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public NotificationEndpointTests(NotificationServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- Helper to seed notifications directly via DbContext ---

    private async Task<Notification> SeedNotificationAsync(
        Guid? userId = null,
        NotificationType type = NotificationType.HabitCompleted,
        DateTimeOffset? readAt = null)
    {
        using var db = _fixture.CreateDbContext();
        var notification = new Notification
        {
            UserId = userId ?? _userId,
            Type = type,
            Data = JsonSerializer.Serialize(new { test = true }),
            ReadAt = readAt
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync(CT);
        return notification;
    }

    // --- GET /notifications ---

    [Fact]
    public async Task GetNotifications_ReturnsOwnNotifications()
    {
        await SeedNotificationAsync();
        await SeedNotificationAsync(userId: Guid.NewGuid()); // other user's notification

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("total").GetInt32());
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task GetNotifications_Pagination_ReturnsCorrectPage()
    {
        for (var i = 0; i < 5; i++)
            await SeedNotificationAsync();

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications?page=2&pageSize=2", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(5, body.GetProperty("total").GetInt32());
        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
        Assert.Equal(2, body.GetProperty("page").GetInt32());
        Assert.Equal(2, body.GetProperty("pageSize").GetInt32());
    }

    [Fact]
    public async Task GetNotifications_DefaultPagination_Returns20PerPage()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(20, body.GetProperty("pageSize").GetInt32());
        Assert.Equal(1, body.GetProperty("page").GetInt32());
    }

    [Fact]
    public async Task GetNotifications_OrderedByCreatedAtDesc()
    {
        var older = await SeedNotificationAsync(type: NotificationType.FriendRequestSent);
        await Task.Delay(50, CT);
        var newer = await SeedNotificationAsync(type: NotificationType.ChallengeCreated);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());
        Assert.Equal("challengecreated", items[0].GetProperty("type").GetString());
        Assert.Equal("friendrequestsent", items[1].GetProperty("type").GetString());
    }

    [Fact]
    public async Task GetNotifications_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();
        var response = await client.GetAsync("/notifications", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetNotifications_EmptyList_ReturnsEmptyItems()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("total").GetInt32());
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task GetNotifications_PageSizeClamped_Max100()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications?pageSize=500", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(100, body.GetProperty("pageSize").GetInt32());
    }

    // --- PUT /notifications/{id}/read ---

    [Fact]
    public async Task MarkAsRead_UnreadNotification_SetsReadAt()
    {
        var notification = await SeedNotificationAsync();

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsync($"/notifications/{notification.Id}/read", null, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.TryGetProperty("readAt", out var readAt));
        Assert.NotEqual(JsonValueKind.Null, readAt.ValueKind);
    }

    [Fact]
    public async Task MarkAsRead_AlreadyRead_DoesNotChangeReadAt()
    {
        var readTime = DateTimeOffset.UtcNow.AddHours(-1);
        var notification = await SeedNotificationAsync(readAt: readTime);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsync($"/notifications/{notification.Id}/read", null, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var returnedReadAt = body.GetProperty("readAt").GetDateTimeOffset();
        // Should remain the original readAt, not change
        Assert.True(Math.Abs((returnedReadAt - readTime).TotalSeconds) < 2);
    }

    [Fact]
    public async Task MarkAsRead_OtherUsersNotification_Returns404()
    {
        var notification = await SeedNotificationAsync(userId: Guid.NewGuid());

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsync($"/notifications/{notification.Id}/read", null, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task MarkAsRead_NonExistentId_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsync($"/notifications/{Guid.NewGuid()}/read", null, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task MarkAsRead_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();
        var response = await client.PutAsync($"/notifications/{Guid.NewGuid()}/read", null, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- PUT /notifications/read-all ---

    [Fact]
    public async Task ReadAll_MarksAllUnreadAsRead()
    {
        await SeedNotificationAsync();
        await SeedNotificationAsync();
        await SeedNotificationAsync(readAt: DateTimeOffset.UtcNow); // already read

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsync("/notifications/read-all", null, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(2, body.GetProperty("markedAsRead").GetInt32());

        // Verify all are now read
        using var db = _fixture.CreateDbContext();
        var unread = await db.Notifications
            .CountAsync(n => n.UserId == _userId && n.ReadAt == null, CT);
        Assert.Equal(0, unread);
    }

    [Fact]
    public async Task ReadAll_NoUnread_ReturnsZero()
    {
        await SeedNotificationAsync(readAt: DateTimeOffset.UtcNow);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsync("/notifications/read-all", null, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("markedAsRead").GetInt32());
    }

    [Fact]
    public async Task ReadAll_DoesNotAffectOtherUsers()
    {
        var otherUserId = Guid.NewGuid();
        await SeedNotificationAsync();
        await SeedNotificationAsync(userId: otherUserId);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PutAsync("/notifications/read-all", null, CT);

        // Other user's notification should still be unread
        using var db = _fixture.CreateDbContext();
        var otherUnread = await db.Notifications
            .CountAsync(n => n.UserId == otherUserId && n.ReadAt == null, CT);
        Assert.Equal(1, otherUnread);
    }

    [Fact]
    public async Task ReadAll_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();
        var response = await client.PutAsync("/notifications/read-all", null, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- GET /notifications/unread-count ---

    [Fact]
    public async Task UnreadCount_ReturnsCorrectCount()
    {
        await SeedNotificationAsync();
        await SeedNotificationAsync();
        await SeedNotificationAsync(readAt: DateTimeOffset.UtcNow);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications/unread-count", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(2, body.GetProperty("unreadCount").GetInt32());
    }

    [Fact]
    public async Task UnreadCount_NoNotifications_ReturnsZero()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications/unread-count", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("unreadCount").GetInt32());
    }

    [Fact]
    public async Task UnreadCount_DoesNotCountOtherUsers()
    {
        await SeedNotificationAsync(userId: Guid.NewGuid());

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications/unread-count", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("unreadCount").GetInt32());
    }

    [Fact]
    public async Task UnreadCount_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();
        var response = await client.GetAsync("/notifications/unread-count", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- PUT /notifications/settings ---

    [Fact]
    public async Task UpdateSettings_CreatesDefaultSettings()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsJsonAsync("/notifications/settings", new
        {
            friendActivity = false
        }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("habitReminders").GetBoolean());
        Assert.False(body.GetProperty("friendActivity").GetBoolean());
        Assert.True(body.GetProperty("challengeUpdates").GetBoolean());
    }

    [Fact]
    public async Task UpdateSettings_UpdatesExistingSettings()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Create initial settings
        await client.PutAsJsonAsync("/notifications/settings", new
        {
            habitReminders = false
        }, CT);

        // Update
        var response = await client.PutAsJsonAsync("/notifications/settings", new
        {
            challengeUpdates = false
        }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.False(body.GetProperty("habitReminders").GetBoolean()); // still false from first call
        Assert.True(body.GetProperty("friendActivity").GetBoolean());
        Assert.False(body.GetProperty("challengeUpdates").GetBoolean()); // updated
    }

    [Fact]
    public async Task UpdateSettings_PartialUpdate_OnlyChangesSpecifiedFields()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Set all to false
        await client.PutAsJsonAsync("/notifications/settings", new
        {
            habitReminders = false,
            friendActivity = false,
            challengeUpdates = false
        }, CT);

        // Only re-enable friendActivity
        var response = await client.PutAsJsonAsync("/notifications/settings", new
        {
            friendActivity = true
        }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.False(body.GetProperty("habitReminders").GetBoolean());
        Assert.True(body.GetProperty("friendActivity").GetBoolean());
        Assert.False(body.GetProperty("challengeUpdates").GetBoolean());
    }

    [Fact]
    public async Task UpdateSettings_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();
        var response = await client.PutAsJsonAsync("/notifications/settings", new
        {
            habitReminders = false
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSettings_EmptyBody_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PutAsync("/notifications/settings", null, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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
}
