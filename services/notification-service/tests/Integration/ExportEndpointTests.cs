using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.NotificationService.Entities;
using Winzy.NotificationService.Tests.Fixtures;
using Xunit;

namespace Winzy.NotificationService.Tests.Integration;

public class ExportEndpointTests : IClassFixture<NotificationServiceFixture>, IAsyncLifetime
{
    private readonly NotificationServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public ExportEndpointTests(NotificationServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- Happy path ---

    [Fact]
    public async Task Export_WithSettingsAndNotifications_ReturnsFullData()
    {
        var now = DateTimeOffset.UtcNow;
        var notificationId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.NotificationSettings.Add(new NotificationSettings
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                HabitReminders = true,
                FriendActivity = false,
                ChallengeUpdates = true,
                CreatedAt = now,
                UpdatedAt = now
            });

            db.Notifications.Add(new Notification
            {
                Id = notificationId,
                UserId = _userId,
                Type = NotificationType.ChallengeCreated,
                Data = """{"challengeId":"00000000-0000-0000-0000-000000000001"}""",
                CreatedAt = now.AddHours(-1),
                UpdatedAt = now.AddHours(-1)
            });

            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/notifications/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("notification", body.GetProperty("service").GetString());

        var data = body.GetProperty("data");

        // Settings
        var settings = data.GetProperty("settings");
        Assert.True(settings.GetProperty("habitReminders").GetBoolean());
        Assert.False(settings.GetProperty("friendActivity").GetBoolean());
        Assert.True(settings.GetProperty("challengeUpdates").GetBoolean());

        // Notifications
        var notifications = data.GetProperty("notifications");
        Assert.Equal(1, notifications.GetArrayLength());
    }

    [Fact]
    public async Task Export_OnlyNotificationsNoSettings_ReturnsDefaultSettings()
    {
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                Type = NotificationType.FriendRequestSent,
                Data = "{}",
                CreatedAt = now,
                UpdatedAt = now
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/notifications/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var settings = body.GetProperty("data").GetProperty("settings");
        // Defaults when no explicit settings exist
        Assert.True(settings.GetProperty("habitReminders").GetBoolean());
        Assert.True(settings.GetProperty("friendActivity").GetBoolean());
        Assert.True(settings.GetProperty("challengeUpdates").GetBoolean());
    }

    [Fact]
    public async Task Export_MultipleNotifications_OrderedByCreatedAtDescending()
    {
        var olderId = Guid.NewGuid();
        var newerId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.NotificationSettings.Add(new NotificationSettings
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
            });

            db.Notifications.AddRange(
                new Notification
                {
                    Id = olderId,
                    UserId = _userId,
                    Type = NotificationType.HabitCompleted,
                    Data = "{}",
                },
                new Notification
                {
                    Id = newerId,
                    UserId = _userId,
                    Type = NotificationType.FriendRequestAccepted,
                    Data = "{}",
                });

            await db.SaveChangesAsync(CT);

            // BaseDbContext.SetTimestamps overrides CreatedAt on save, so use raw SQL
            await db.Database.ExecuteSqlAsync(
                $"UPDATE notifications SET created_at = NOW() - INTERVAL '3 hours' WHERE id = {olderId}", CT);
            await db.Database.ExecuteSqlAsync(
                $"UPDATE notifications SET created_at = NOW() - INTERVAL '1 hour' WHERE id = {newerId}", CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/notifications/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var notifications = body.GetProperty("data").GetProperty("notifications");
        Assert.Equal(2, notifications.GetArrayLength());

        // Most recent first
        var first = notifications[0].GetProperty("type").GetString();
        var second = notifications[1].GetProperty("type").GetString();
        Assert.Equal("friendrequestaccepted", first);
        Assert.Equal("habitcompleted", second);
    }

    // --- Edge cases / Error conditions ---

    [Fact]
    public async Task Export_NoData_Returns404()
    {
        var unknownUserId = Guid.NewGuid();

        using var client = _fixture.CreateAuthenticatedClient(unknownUserId);
        var response = await client.GetAsync($"/notifications/internal/export/{unknownUserId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Export_OnlySettings_ReturnsOk()
    {
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.NotificationSettings.Add(new NotificationSettings
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                HabitReminders = false,
                FriendActivity = true,
                ChallengeUpdates = false,
                CreatedAt = now,
                UpdatedAt = now
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/notifications/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("notification", body.GetProperty("service").GetString());
        Assert.Equal(0, body.GetProperty("data").GetProperty("notifications").GetArrayLength());
    }
}
