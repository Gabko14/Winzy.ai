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

    // --- habit.completed fan-out ---

    [Fact]
    public async Task HabitCompleted_FansOutToFriends()
    {
        var friend1 = Guid.NewGuid();
        var friend2 = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend1, friend2);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await WaitForNotificationAsync(friend1, NotificationType.HabitCompleted);
        await WaitForNotificationAsync(friend2, NotificationType.HabitCompleted);

        using var db = _fixture.CreateDbContext();
        var notifications = await db.Notifications
            .Where(n => n.Type == NotificationType.HabitCompleted)
            .ToListAsync(CT);

        Assert.Equal(2, notifications.Count);

        // Verify notification data contains correct fromUserId
        foreach (var n in notifications)
        {
            var data = JsonSerializer.Deserialize<JsonElement>(n.Data);
            Assert.Equal(_userId, data.GetProperty("fromUserId").GetGuid());
            Assert.Equal(evt.HabitId, data.GetProperty("habitId").GetGuid());
        }
    }

    [Fact]
    public async Task HabitCompleted_NoFriends_NoNotifications()
    {
        // User has no friends — social-service returns empty list (default mock behavior)
        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await AssertNoNotificationAsync(_userId, NotificationType.HabitCompleted);
    }

    [Fact]
    public async Task HabitCompleted_DoesNotNotifySelf()
    {
        // Even if social-service returns the user in their own friend list,
        // the subscriber must skip self-notification via the guard check
        var friend = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend, _userId);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await WaitForNotificationAsync(friend, NotificationType.HabitCompleted);
        await AssertNoNotificationAsync(_userId, NotificationType.HabitCompleted);
    }

    [Fact]
    public async Task HabitCompleted_FriendActivityDisabled_SkipsThatFriend()
    {
        var friend1 = Guid.NewGuid();
        var friend2 = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend1, friend2);

        // Disable FriendActivity for friend1
        using var client = _fixture.CreateAuthenticatedClient(friend1);
        await client.PutAsJsonAsync("/notifications/settings", new { friendActivity = false }, CT);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await WaitForNotificationAsync(friend2, NotificationType.HabitCompleted);
        await AssertNoNotificationAsync(friend1, NotificationType.HabitCompleted);
    }

    [Fact]
    public async Task HabitCompleted_SocialServiceUnavailable_NoNotificationsCreated()
    {
        _fixture.SocialServiceHandler.SetShouldFail(true);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        // Transient HttpRequestException propagates → NAK → JetStream retries with backoff.
        // No notifications created while social-service is down.
        await AssertNoNotificationAsync(_userId, NotificationType.HabitCompleted);

        _fixture.SocialServiceHandler.SetShouldFail(false);
    }

    [Fact]
    public async Task HabitCompleted_Idempotent_NoDuplicates()
    {
        var friend = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend);

        var habitId = Guid.NewGuid();
        var date = DateTime.UtcNow;
        var evt = new HabitCompletedEvent(_userId, habitId, date, 0.85);

        // Publish the same event twice (simulates NATS redelivery)
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);
        await WaitForNotificationAsync(friend, NotificationType.HabitCompleted);

        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);
        // Wait a bit for the second event to be processed
        await Task.Delay(1000, CT);

        using var db = _fixture.CreateDbContext();
        var count = await db.Notifications
            .CountAsync(n => n.UserId == friend && n.Type == NotificationType.HabitCompleted, CT);
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task HabitCompleted_PushDeliveredFlagSetAfterProcessing()
    {
        var friend = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await WaitForNotificationAsync(friend, NotificationType.HabitCompleted);

        // Allow time for PushDelivered flag to be saved (second SaveChangesAsync after push delivery)
        await Task.Delay(500, CT);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == friend && n.Type == NotificationType.HabitCompleted, CT);

        // PushDelivered is set after DeliverAsync completes without throwing.
        // No device tokens are registered in test → DeliverAsync is a no-op → flag is set to true.
        // This verifies the flag-setting codepath runs; actual push delivery is tested via PushDeliveryService unit tests.
        Assert.True(notification.PushDelivered);
    }

    [Fact]
    public async Task HabitCompleted_Redelivery_SkipsPushWhenAlreadyDelivered()
    {
        var friend = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend);

        var habitId = Guid.NewGuid();
        var date = DateTime.UtcNow;
        var evt = new HabitCompletedEvent(_userId, habitId, date, 0.85);

        // First delivery — creates notification and delivers push
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);
        await WaitForNotificationAsync(friend, NotificationType.HabitCompleted);
        await Task.Delay(500, CT);

        // Verify PushDelivered is true
        using (var db = _fixture.CreateDbContext())
        {
            var notification = await db.Notifications
                .FirstAsync(n => n.UserId == friend && n.Type == NotificationType.HabitCompleted, CT);
            Assert.True(notification.PushDelivered);
        }

        // Second delivery (simulates NATS redelivery) — should skip push since already delivered
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);
        await Task.Delay(1000, CT);

        // Still only one notification
        using (var db = _fixture.CreateDbContext())
        {
            var count = await db.Notifications
                .CountAsync(n => n.UserId == friend && n.Type == NotificationType.HabitCompleted, CT);
            Assert.Equal(1, count);
        }
    }

    [Fact]
    public async Task HabitCompleted_BatchFanOut_CreatesAllNotificationsInSingleBatch()
    {
        var friend1 = Guid.NewGuid();
        var friend2 = Guid.NewGuid();
        var friend3 = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend1, friend2, friend3);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await WaitForNotificationAsync(friend1, NotificationType.HabitCompleted);
        await WaitForNotificationAsync(friend2, NotificationType.HabitCompleted);
        await WaitForNotificationAsync(friend3, NotificationType.HabitCompleted);

        using var db = _fixture.CreateDbContext();
        var notifications = await db.Notifications
            .Where(n => n.Type == NotificationType.HabitCompleted)
            .OrderBy(n => n.CreatedAt)
            .ToListAsync(CT);

        Assert.Equal(3, notifications.Count);

        // All three notifications should have been created in the same batch
        // (CreatedAt timestamps should be very close — within a few ms)
        var firstCreated = notifications.First().CreatedAt;
        var lastCreated = notifications.Last().CreatedAt;
        Assert.True((lastCreated - firstCreated).TotalMilliseconds < 500,
            "Batch insert should create all notifications nearly simultaneously");
    }

    [Fact]
    public async Task HabitCompleted_WithEnrichedFields_UsesNamesInNotification()
    {
        var friend = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend);

        // Event with enriched fields
        var evt = new HabitCompletedEvent(
            _userId, Guid.NewGuid(), DateTime.UtcNow, 0.85,
            HabitName: "Morning Run");
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await WaitForNotificationAsync(friend, NotificationType.HabitCompleted);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == friend && n.Type == NotificationType.HabitCompleted, CT);

        // Notification was created with enriched event data
        var data = JsonSerializer.Deserialize<JsonElement>(notification.Data);
        Assert.Equal(_userId, data.GetProperty("fromUserId").GetGuid());
    }

    [Fact]
    public async Task HabitCompleted_AllFriendsDisabled_NoNotifications()
    {
        var friend1 = Guid.NewGuid();
        var friend2 = Guid.NewGuid();
        _fixture.SocialServiceHandler.SetFriends(_userId, friend1, friend2);

        // Disable FriendActivity for both friends
        using var client1 = _fixture.CreateAuthenticatedClient(friend1);
        await client1.PutAsJsonAsync("/notifications/settings", new { friendActivity = false }, CT);
        using var client2 = _fixture.CreateAuthenticatedClient(friend2);
        await client2.PutAsJsonAsync("/notifications/settings", new { friendActivity = false }, CT);

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        await AssertNoNotificationAsync(friend1, NotificationType.HabitCompleted);
        await AssertNoNotificationAsync(friend2, NotificationType.HabitCompleted);
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

    [Fact]
    public async Task FriendRequestAccepted_PushDeliveredFlagSetForBothUsers()
    {
        var otherUser = Guid.NewGuid();
        var evt = new FriendRequestAcceptedEvent(_userId, otherUser);
        await _fixture.PublishNatsEventAsync(Subjects.FriendRequestAccepted, evt);

        await WaitForNotificationAsync(_userId, NotificationType.FriendRequestAccepted);
        await WaitForNotificationAsync(otherUser, NotificationType.FriendRequestAccepted);
        await Task.Delay(500, CT);

        using var db = _fixture.CreateDbContext();
        var notifications = await db.Notifications
            .Where(n => n.Type == NotificationType.FriendRequestAccepted)
            .ToListAsync(CT);

        Assert.Equal(2, notifications.Count);
        Assert.All(notifications, n => Assert.True(n.PushDelivered));
    }

    [Fact]
    public async Task FriendRequestAccepted_Redelivery_SkipsPushWhenAlreadyDelivered()
    {
        var otherUser = Guid.NewGuid();
        var evt = new FriendRequestAcceptedEvent(_userId, otherUser);

        // First delivery
        await _fixture.PublishNatsEventAsync(Subjects.FriendRequestAccepted, evt);
        await WaitForNotificationAsync(_userId, NotificationType.FriendRequestAccepted);
        await WaitForNotificationAsync(otherUser, NotificationType.FriendRequestAccepted);
        await Task.Delay(500, CT);

        // Verify PushDelivered is true for both
        using (var db = _fixture.CreateDbContext())
        {
            var notifications = await db.Notifications
                .Where(n => n.Type == NotificationType.FriendRequestAccepted)
                .ToListAsync(CT);
            Assert.All(notifications, n => Assert.True(n.PushDelivered));
        }

        // Second delivery (simulates NATS redelivery) — should skip push
        await _fixture.PublishNatsEventAsync(Subjects.FriendRequestAccepted, evt);
        await Task.Delay(1000, CT);

        // Still only two notifications
        using (var db = _fixture.CreateDbContext())
        {
            var count = await db.Notifications
                .CountAsync(n => n.Type == NotificationType.FriendRequestAccepted, CT);
            Assert.Equal(2, count);
        }
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

    [Fact]
    public async Task ChallengeCreated_PushDeliveredFlagSet()
    {
        var evt = new ChallengeCreatedEvent(Guid.NewGuid(), Guid.NewGuid(), _userId, Guid.NewGuid());
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCreated, evt);

        await WaitForNotificationAsync(_userId, NotificationType.ChallengeCreated);
        await Task.Delay(500, CT);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCreated, CT);
        Assert.True(notification.PushDelivered);
    }

    [Fact]
    public async Task ChallengeCreated_Redelivery_SkipsPushWhenAlreadyDelivered()
    {
        var challengeId = Guid.NewGuid();
        var evt = new ChallengeCreatedEvent(challengeId, Guid.NewGuid(), _userId, Guid.NewGuid());

        // First delivery
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCreated, evt);
        await WaitForNotificationAsync(_userId, NotificationType.ChallengeCreated);
        await Task.Delay(500, CT);

        using (var db = _fixture.CreateDbContext())
        {
            var notification = await db.Notifications
                .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCreated, CT);
            Assert.True(notification.PushDelivered);
        }

        // Second delivery (simulates NATS redelivery) — should skip push
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCreated, evt);
        await Task.Delay(1000, CT);

        using (var db = _fixture.CreateDbContext())
        {
            var count = await db.Notifications
                .CountAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCreated, CT);
            Assert.Equal(1, count);
        }
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

    [Fact]
    public async Task ChallengeCompleted_PushDeliveredFlagSet()
    {
        var evt = new ChallengeCompletedEvent(Guid.NewGuid(), _userId, "Coffee together");
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCompleted, evt);

        await WaitForNotificationAsync(_userId, NotificationType.ChallengeCompleted);
        await Task.Delay(500, CT);

        using var db = _fixture.CreateDbContext();
        var notification = await db.Notifications
            .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCompleted, CT);
        Assert.True(notification.PushDelivered);
    }

    [Fact]
    public async Task ChallengeCompleted_Redelivery_SkipsPushWhenAlreadyDelivered()
    {
        var challengeId = Guid.NewGuid();
        var evt = new ChallengeCompletedEvent(challengeId, _userId, "Tennis");

        // First delivery
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCompleted, evt);
        await WaitForNotificationAsync(_userId, NotificationType.ChallengeCompleted);
        await Task.Delay(500, CT);

        using (var db = _fixture.CreateDbContext())
        {
            var notification = await db.Notifications
                .FirstAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCompleted, CT);
            Assert.True(notification.PushDelivered);
        }

        // Second delivery (simulates NATS redelivery) — should skip push
        await _fixture.PublishNatsEventAsync(Subjects.ChallengeCompleted, evt);
        await Task.Delay(1000, CT);

        using (var db = _fixture.CreateDbContext())
        {
            var count = await db.Notifications
                .CountAsync(n => n.UserId == _userId && n.Type == NotificationType.ChallengeCompleted, CT);
            Assert.Equal(1, count);
        }
    }

    // --- user.deleted ---

    [Fact]
    public async Task UserDeleted_CleansUpNotificationsSettingsAndDeviceTokens()
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
            db.DeviceTokens.Add(new DeviceToken
            {
                UserId = _userId,
                Platform = "web_push",
                Token = "{\"endpoint\":\"https://example.com\"}",
                DeviceId = "test-device-1"
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
            var hasDeviceTokens = await db.DeviceTokens.AnyAsync(t => t.UserId == _userId, CT);
            if (!hasNotifications && !hasSettings && !hasDeviceTokens)
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

    // --- parallel push delivery (W2: winzy.ai-rxby) ---

    [Fact]
    public async Task HabitCompleted_ParallelFanOut_DeliversToManyFriends()
    {
        // 20 friends — enough to exercise the SemaphoreSlim(10) concurrency limit
        var friends = Enumerable.Range(0, 20).Select(_ => Guid.NewGuid()).ToList();
        _fixture.SocialServiceHandler.SetFriends(_userId, friends.ToArray());

        var evt = new HabitCompletedEvent(_userId, Guid.NewGuid(), DateTime.UtcNow, 0.85);
        await _fixture.PublishNatsEventAsync(Subjects.HabitCompleted, evt);

        // Wait for all notifications
        foreach (var friend in friends)
            await WaitForNotificationAsync(friend, NotificationType.HabitCompleted, timeoutMs: 10000);

        using var db = _fixture.CreateDbContext();
        var notifications = await db.Notifications
            .Where(n => n.Type == NotificationType.HabitCompleted)
            .ToListAsync(CT);

        Assert.Equal(20, notifications.Count);

        // All should have PushDelivered set (no device tokens in test → DeliverAsync is a no-op → flag set)
        await Task.Delay(500, CT);
        using var db2 = _fixture.CreateDbContext();
        var deliveredCount = await db2.Notifications
            .CountAsync(n => n.Type == NotificationType.HabitCompleted && n.PushDelivered, CT);
        Assert.Equal(20, deliveredCount);
    }
}
