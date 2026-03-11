using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.NotificationService.Entities;
using Winzy.NotificationService.Tests.Fixtures;
using Xunit;

namespace Winzy.NotificationService.Tests.Integration;

public class NotificationSubscriberTests : IClassFixture<NotificationServiceFixture>, IAsyncLifetime
{
    private readonly NotificationServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public NotificationSubscriberTests(NotificationServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private async Task WaitForNotificationAsync(Guid userId, NotificationType type, int timeoutMs = 5000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            if (await db.Notifications.AnyAsync(n => n.UserId == userId && n.Type == type, CT))
                return;
            await Task.Delay(100, CT);
        }
        throw new TimeoutException($"Notification {type} for user {userId} not found within {timeoutMs}ms");
    }

    private async Task AssertNoNotificationAsync(Guid userId, NotificationType type, int waitMs = 1000)
    {
        await Task.Delay(waitMs, CT);
        using var db = _fixture.CreateDbContext();
        var exists = await db.Notifications.AnyAsync(n => n.UserId == userId && n.Type == type, CT);
        Assert.False(exists, $"Expected no {type} notification for user {userId}, but one was found");
    }

    // --- habit.completed ---

    [Fact]
    public async Task HabitCompleted_CreatesNotification()
    {
        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await WaitForNotificationAsync(_userId, NotificationType.HabitCompleted);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.HabitCompleted, CT);
        Assert.NotNull(notification);
        Assert.Null(notification.ReadAt);

        var data = JsonSerializer.Deserialize<JsonElement>(notification.Data);
        Assert.Equal(evt.HabitId, data.GetProperty("habitId").GetGuid());
        Assert.Equal(0.85, data.GetProperty("consistency").GetDouble(), 2);
    }

    [Fact]
    public async Task HabitCompleted_HabitRemindersDisabled_NoNotification()
    {
        // HabitCompleted uses HabitReminders setting (not FriendActivity)
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PutAsJsonAsync("/notifications/settings", new { habitReminders = false }, CT);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.5);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await AssertNoNotificationAsync(_userId, NotificationType.HabitCompleted);
    }

    // --- friend.request.sent ---

    [Fact]
    public async Task FriendRequestSent_CreatesNotificationForRecipient()
    {
        var fromUser = Guid.NewGuid();
        var evt = new FriendRequestSentEvent(fromUser, _userId);
        await _fixture.PublishNatsEventAsync(Subjects.FriendRequestSent, evt);

        await WaitForNotificationAsync(_userId, NotificationType.FriendRequestSent);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.FriendRequestSent, CT);

        var data = JsonSerializer.Deserialize<JsonElement>(notification.Data);
        Assert.Equal(fromUser, data.GetProperty("fromUserId").GetGuid());
    }

    [Fact]
    public async Task FriendRequestSent_SettingsDisabled_NoNotification()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PutAsJsonAsync("/notifications/settings", new { friendActivity = false }, CT);

        var evt = new FriendRequestSentEvent(Guid.NewGuid(), _userId);
        await _fixture.PublishNatsEventAsync(Subjects.FriendRequestSent, evt);

        await AssertNoNotificationAsync(_userId, NotificationType.FriendRequestSent);
    }

    // --- friend.request.accepted ---

    [Fact]
    public async Task FriendRequestAccepted_CreateNotificationsForBothUsers()
    {
        var otherUser = Guid.NewGuid();
        var evt = new FriendRequestAcceptedEvent(_userId, otherUser);
        await _fixture.PublishNatsEventAsync(Subjects.FriendRequestAccepted, evt);

        await WaitForNotificationAsync(_userId, NotificationType.FriendRequestAccepted);
        await WaitForNotificationAsync(otherUser, NotificationType.FriendRequestAccepted);

        using var db = _fixture.CreateDbContext();
        var count = await db.Notifications
            .CountAsync(n => n.Type == NotificationType.FriendRequestAccepted, CT);
        Assert.Equal(2, count);
    }

    [Fact]
    public async Task FriendRequestAccepted_OneUserDisabled_OnlyOtherGetsNotification()
    {
        var otherUser = Guid.NewGuid();

        // Disable friend activity for _userId
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PutAsJsonAsync("/notifications/settings", new { friendActivity = false }, CT);

        var evt = new FriendRequestAcceptedEvent(_userId, otherUser);
        await _fixture.PublishNatsEventAsync(Subjects.FriendRequestAccepted, evt);

        await WaitForNotificationAsync(otherUser, NotificationType.FriendRequestAccepted);
        await AssertNoNotificationAsync(_userId, NotificationType.FriendRequestAccepted);
    }

    // --- challenge.created ---

    [Fact]
    public async Task ChallengeCreated_CreatesNotificationForRecipient()
    {
        var fromUser = Guid.NewGuid();
        var challengeId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var evt = new ChallengeCreatedEvent(challengeId, fromUser, _userId, habitId);
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCreated, evt);

        await WaitForNotificationAsync(_userId, NotificationType.ChallengeCreated);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCreated, CT);

        var data = JsonSerializer.Deserialize<JsonElement>(notification.Data);
        Assert.Equal(challengeId, data.GetProperty("challengeId").GetGuid());
        Assert.Equal(fromUser, data.GetProperty("fromUserId").GetGuid());
        Assert.Equal(habitId, data.GetProperty("habitId").GetGuid());
    }

    [Fact]
    public async Task ChallengeCreated_SettingsDisabled_NoNotification()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PutAsJsonAsync("/notifications/settings", new { challengeUpdates = false }, CT);

        var evt = new ChallengeCreatedEvent(Guid.NewGuid(), Guid.NewGuid(), _userId, Guid.NewGuid());
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCreated, evt);

        await AssertNoNotificationAsync(_userId, NotificationType.ChallengeCreated);
    }

    // --- challenge.completed ---

    [Fact]
    public async Task ChallengeCompleted_CreatesNotification()
    {
        var challengeId = Guid.NewGuid();
        var evt = new ChallengeCompletedEvent(challengeId, _userId, "Coffee together");
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCompleted, evt);

        await WaitForNotificationAsync(_userId, NotificationType.ChallengeCompleted);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCompleted, CT);

        var data = JsonSerializer.Deserialize<JsonElement>(notification.Data);
        Assert.Equal(challengeId, data.GetProperty("challengeId").GetGuid());
        Assert.Equal("Coffee together", data.GetProperty("reward").GetString());
    }

    [Fact]
    public async Task ChallengeCompleted_SettingsDisabled_NoNotification()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PutAsJsonAsync("/notifications/settings", new { challengeUpdates = false }, CT);

        var evt = new ChallengeCompletedEvent(Guid.NewGuid(), _userId, "Tennis");
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCompleted, evt);

        await AssertNoNotificationAsync(_userId, NotificationType.ChallengeCompleted);
    }

    // --- user.deleted ---

    [Fact]
    public async Task UserDeleted_CleansUpNotificationsAndSettings()
    {
        // Seed data for the user
        using (var db = _fixture.CreateDbContext())
        {
            db.Notifications.Add(new Notification
            {
                UserId = _userId,
                Type = NotificationType.HabitCompleted,
                Data = "{}"
            });
            db.Notifications.Add(new Notification
            {
                UserId = _userId,
                Type = NotificationType.FriendRequestSent,
                Data = "{}"
            });
            db.NotificationSettings.Add(new NotificationSettings
            {
                UserId = _userId
            });
            await db.SaveChangesAsync(CT);
        }

        var evt = new UserDeletedEvent(_userId);
        await _fixture.PublishNatsEventAsync(Subjects.UserDeleted, evt);

        // Wait for cleanup
        var deadline = DateTime.UtcNow.AddMilliseconds(5000);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            var hasNotifications = await db.Notifications.AnyAsync(n => n.UserId == _userId, CT);
            var hasSettings = await db.NotificationSettings.AnyAsync(s => s.UserId == _userId, CT);
            if (!hasNotifications && !hasSettings)
                return;
            await Task.Delay(100, CT);
        }

        Assert.Fail("user.deleted cleanup did not complete within 5 seconds");
    }

    [Fact]
    public async Task UserDeleted_DoesNotAffectOtherUsers()
    {
        var otherUser = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.Notifications.Add(new Notification
            {
                UserId = _userId,
                Type = NotificationType.HabitCompleted,
                Data = "{}"
            });
            db.Notifications.Add(new Notification
            {
                UserId = otherUser,
                Type = NotificationType.HabitCompleted,
                Data = "{}"
            });
            await db.SaveChangesAsync(CT);
        }

        await _fixture.PublishNatsEventAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId));

        // Wait for _userId's notifications to be deleted
        var deadline = DateTime.UtcNow.AddMilliseconds(5000);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            if (!await db.Notifications.AnyAsync(n => n.UserId == _userId, CT))
                break;
            await Task.Delay(100, CT);
        }

        // Verify other user's data is untouched
        using (var db = _fixture.CreateDbContext())
        {
            var otherNotifications = await db.Notifications
                .CountAsync(n => n.UserId == otherUser, CT);
            Assert.Equal(1, otherNotifications);
        }
    }
}
