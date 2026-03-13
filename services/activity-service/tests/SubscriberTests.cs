using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Xunit;

namespace Winzy.ActivityService.Tests;

[Collection("ActivityService")]
public class SubscriberTests : IAsyncLifetime
{
    private readonly ActivityServiceFixture _fixture;

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public SubscriberTests(ActivityServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task UserRegistered_CreatesFeedEntry()
    {
        var userId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        await publisher.PublishAsync(Subjects.UserRegistered,
            new UserRegisteredEvent(userId, "testuser"), CT);

        await WaitForEntryAsync(userId, Subjects.UserRegistered);

        using var db = _fixture.CreateDbContext();
        var entry = await db.FeedEntries.FirstAsync(e => e.ActorId == userId, CT);
        Assert.Equal(Subjects.UserRegistered, entry.EventType);
        Assert.NotNull(entry.Data);

        var data = entry.Data!.RootElement;
        Assert.Equal("testuser", data.GetProperty("username").GetString());
    }

    [Fact]
    public async Task HabitCreated_CreatesFeedEntry()
    {
        var userId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId, "Meditate"), CT);

        await WaitForEntryAsync(userId, Subjects.HabitCreated);

        using var db = _fixture.CreateDbContext();
        var entry = await db.FeedEntries.FirstAsync(e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        var data = entry.Data!.RootElement;
        Assert.Equal(habitId, data.GetProperty("habitId").GetGuid());
        Assert.Equal("Meditate", data.GetProperty("name").GetString());
    }

    [Fact]
    public async Task HabitCompleted_CreatesFeedEntry()
    {
        var userId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(userId, habitId, DateTime.UtcNow, 0.85), CT);

        await WaitForEntryAsync(userId, Subjects.HabitCompleted);

        using var db = _fixture.CreateDbContext();
        var entry = await db.FeedEntries.FirstAsync(e => e.ActorId == userId && e.EventType == Subjects.HabitCompleted, CT);
        var data = entry.Data!.RootElement;
        Assert.Equal(0.85, data.GetProperty("consistency").GetDouble());
    }

    [Fact]
    public async Task FriendRequestAccepted_CreatesTwoFeedEntries()
    {
        var userId1 = Guid.NewGuid();
        var userId2 = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        await publisher.PublishAsync(Subjects.FriendRequestAccepted,
            new FriendRequestAcceptedEvent(userId1, userId2), CT);

        // Wait for both entries
        await WaitForEntryAsync(userId1, Subjects.FriendRequestAccepted);
        await WaitForEntryAsync(userId2, Subjects.FriendRequestAccepted);

        using var db = _fixture.CreateDbContext();
        var entries = await db.FeedEntries
            .Where(e => e.EventType == Subjects.FriendRequestAccepted)
            .Where(e => e.ActorId == userId1 || e.ActorId == userId2)
            .ToListAsync(CT);

        Assert.Equal(2, entries.Count);
        Assert.Contains(entries, e => e.ActorId == userId1);
        Assert.Contains(entries, e => e.ActorId == userId2);
    }

    [Fact]
    public async Task ChallengeCreated_CreatesFeedEntry()
    {
        var fromUserId = Guid.NewGuid();
        var toUserId = Guid.NewGuid();
        var challengeId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        await publisher.PublishAsync(Subjects.ChallengeCreated,
            new ChallengeCreatedEvent(challengeId, fromUserId, toUserId, habitId), CT);

        await WaitForEntryAsync(fromUserId, Subjects.ChallengeCreated);

        using var db = _fixture.CreateDbContext();
        var entry = await db.FeedEntries.FirstAsync(
            e => e.ActorId == fromUserId && e.EventType == Subjects.ChallengeCreated, CT);
        var data = entry.Data!.RootElement;
        Assert.Equal(challengeId, data.GetProperty("challengeId").GetGuid());
    }

    [Fact]
    public async Task ChallengeCompleted_CreatesFeedEntry()
    {
        var userId = Guid.NewGuid();
        var challengeId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        await publisher.PublishAsync(Subjects.ChallengeCompleted,
            new ChallengeCompletedEvent(challengeId, userId, "Coffee together!"), CT);

        await WaitForEntryAsync(userId, Subjects.ChallengeCompleted);

        using var db = _fixture.CreateDbContext();
        var entry = await db.FeedEntries.FirstAsync(
            e => e.ActorId == userId && e.EventType == Subjects.ChallengeCompleted, CT);
        var data = entry.Data!.RootElement;
        Assert.Equal("Coffee together!", data.GetProperty("reward").GetString());
    }

    [Fact]
    public async Task UserDeleted_RemovesFeedEntries()
    {
        var userId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // First create some entries
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, Guid.NewGuid(), "Habit1"), CT);
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, Guid.NewGuid(), "Habit2"), CT);

        // Wait for entries to be created
        await WaitForCountAsync(userId, 2);

        // Now delete the user
        await publisher.PublishAsync(Subjects.UserDeleted,
            new UserDeletedEvent(userId), CT);

        // Wait for entries to be deleted
        await WaitForCountAsync(userId, 0);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.FeedEntries.CountAsync(e => e.ActorId == userId, CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UserDeleted_DoesNotAffectOtherUsers()
    {
        var deletedUserId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create entries for both users
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(deletedUserId, Guid.NewGuid(), "Deleted"), CT);
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(otherUserId, Guid.NewGuid(), "Other"), CT);

        await WaitForEntryAsync(deletedUserId, Subjects.HabitCreated);
        await WaitForEntryAsync(otherUserId, Subjects.HabitCreated);

        // Delete one user
        await publisher.PublishAsync(Subjects.UserDeleted,
            new UserDeletedEvent(deletedUserId), CT);

        await WaitForCountAsync(deletedUserId, 0);

        using var db = _fixture.CreateDbContext();
        var otherEntries = await db.FeedEntries.CountAsync(e => e.ActorId == otherUserId, CT);
        Assert.Equal(1, otherEntries);
    }

    [Fact]
    public async Task UserDeleted_RemovesReferencingEntries()
    {
        var deletedUserId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create a friendship event — both users get an entry, both reference each other in JSONB
        await publisher.PublishAsync(Subjects.FriendRequestAccepted,
            new FriendRequestAcceptedEvent(deletedUserId, otherUserId), CT);

        await WaitForEntryAsync(deletedUserId, Subjects.FriendRequestAccepted);
        await WaitForEntryAsync(otherUserId, Subjects.FriendRequestAccepted);

        // Delete one user
        await publisher.PublishAsync(Subjects.UserDeleted,
            new UserDeletedEvent(deletedUserId), CT);

        // Wait for actor entries to be deleted
        await WaitForCountAsync(deletedUserId, 0);

        // The other user's friend.request.accepted entry should also be removed
        // because it references the deleted user in its JSONB data
        using var db = _fixture.CreateDbContext();
        var otherFriendEntries = await db.FeedEntries
            .CountAsync(e => e.ActorId == otherUserId && e.EventType == Subjects.FriendRequestAccepted, CT);
        Assert.Equal(0, otherFriendEntries);
    }

    // --- Idempotency ---

    [Fact]
    public async Task HabitCreated_DuplicateEvent_DoesNotCreateDuplicateEntry()
    {
        var userId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Publish the same event twice
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId, "Meditate"), CT);
        await WaitForEntryAsync(userId, Subjects.HabitCreated);

        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId, "Meditate"), CT);

        // Give time for the second event to be processed (or skipped)
        await Task.Delay(500, CT);

        using var db = _fixture.CreateDbContext();
        var count = await db.FeedEntries.CountAsync(
            e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task FriendRequestAccepted_DuplicateEvent_DoesNotCreateDuplicateEntries()
    {
        var userId1 = Guid.NewGuid();
        var userId2 = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        await publisher.PublishAsync(Subjects.FriendRequestAccepted,
            new FriendRequestAcceptedEvent(userId1, userId2), CT);
        await WaitForEntryAsync(userId1, Subjects.FriendRequestAccepted);
        await WaitForEntryAsync(userId2, Subjects.FriendRequestAccepted);

        // Publish the same event again
        await publisher.PublishAsync(Subjects.FriendRequestAccepted,
            new FriendRequestAcceptedEvent(userId1, userId2), CT);
        await Task.Delay(500, CT);

        using var db = _fixture.CreateDbContext();
        var count = await db.FeedEntries.CountAsync(
            e => e.EventType == Subjects.FriendRequestAccepted
                && (e.ActorId == userId1 || e.ActorId == userId2), CT);
        Assert.Equal(2, count);
    }

    // --- Visibility Changed ---

    [Fact]
    public async Task VisibilityChanged_NarrowingDeletesEntries()
    {
        var userId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create a habit entry first
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId, "Meditate"), CT);
        await WaitForEntryAsync(userId, Subjects.HabitCreated);

        // Narrow visibility: public -> private
        await publisher.PublishAsync(Subjects.VisibilityChanged,
            new VisibilityChangedEvent(userId, habitId, "public", "private"), CT);

        // Wait for soft-delete
        await WaitForSoftDeletedAsync(userId, Subjects.HabitCreated);

        // Entry should not appear in normal queries (global query filter)
        using var db = _fixture.CreateDbContext();
        var visibleCount = await db.FeedEntries.CountAsync(
            e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        Assert.Equal(0, visibleCount);

        // But should still exist as soft-deleted
        var totalCount = await db.FeedEntries.IgnoreQueryFilters().CountAsync(
            e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        Assert.Equal(1, totalCount);
    }

    [Fact]
    public async Task VisibilityChanged_WideningDoesNotDelete()
    {
        var userId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create a habit entry
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId, "Read"), CT);
        await WaitForEntryAsync(userId, Subjects.HabitCreated);

        // Widen visibility: private -> public (should NOT delete)
        await publisher.PublishAsync(Subjects.VisibilityChanged,
            new VisibilityChangedEvent(userId, habitId, "private", "public"), CT);

        // Give time for event to be processed
        await Task.Delay(500, CT);

        // Entry should still be visible
        using var db = _fixture.CreateDbContext();
        var count = await db.FeedEntries.CountAsync(
            e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task VisibilityChanged_WideningRestoresSoftDeletedEntries()
    {
        var userId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create a habit entry
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId, "Meditate"), CT);
        await WaitForEntryAsync(userId, Subjects.HabitCreated);

        // Narrow: public -> private (soft-deletes)
        await publisher.PublishAsync(Subjects.VisibilityChanged,
            new VisibilityChangedEvent(userId, habitId, "public", "private"), CT);
        await WaitForSoftDeletedAsync(userId, Subjects.HabitCreated);

        // Confirm entry is soft-deleted (invisible to normal queries)
        {
            using var db = _fixture.CreateDbContext();
            var visibleCount = await db.FeedEntries.CountAsync(
                e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
            Assert.Equal(0, visibleCount);
        }

        // Widen: private -> public (should restore)
        await publisher.PublishAsync(Subjects.VisibilityChanged,
            new VisibilityChangedEvent(userId, habitId, "private", "public"), CT);

        // Wait for restore
        await WaitForRestoredAsync(userId, Subjects.HabitCreated);

        // Entry should be visible again
        using var dbAfter = _fixture.CreateDbContext();
        var restoredCount = await dbAfter.FeedEntries.CountAsync(
            e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        Assert.Equal(1, restoredCount);

        // And deleted_at should be null
        var entry = await dbAfter.FeedEntries.FirstAsync(
            e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        Assert.Null(entry.DeletedAt);
    }

    [Fact]
    public async Task VisibilityChanged_IdempotentUnderRedelivery()
    {
        var userId = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create a habit entry
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId, "Exercise"), CT);
        await WaitForEntryAsync(userId, Subjects.HabitCreated);

        // Narrow visibility twice (simulating redelivery)
        await publisher.PublishAsync(Subjects.VisibilityChanged,
            new VisibilityChangedEvent(userId, habitId, "public", "private"), CT);
        await WaitForSoftDeletedAsync(userId, Subjects.HabitCreated);

        await publisher.PublishAsync(Subjects.VisibilityChanged,
            new VisibilityChangedEvent(userId, habitId, "public", "private"), CT);
        await Task.Delay(500, CT);

        // Should still have exactly 1 soft-deleted entry
        using var db = _fixture.CreateDbContext();
        var totalCount = await db.FeedEntries.IgnoreQueryFilters().CountAsync(
            e => e.ActorId == userId && e.EventType == Subjects.HabitCreated, CT);
        Assert.Equal(1, totalCount);
    }

    [Fact]
    public async Task VisibilityChanged_OnlyDeletesTargetHabit()
    {
        var userId = Guid.NewGuid();
        var habitId1 = Guid.NewGuid();
        var habitId2 = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create two habit entries
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId1, "Habit1"), CT);
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId, habitId2, "Habit2"), CT);
        await WaitForCountAsync(userId, 2);

        // Narrow visibility for habit1 only
        await publisher.PublishAsync(Subjects.VisibilityChanged,
            new VisibilityChangedEvent(userId, habitId1, "public", "private"), CT);
        await WaitForSoftDeletedAsync(userId, Subjects.HabitCreated);

        // habit2 should still be visible
        using var db = _fixture.CreateDbContext();
        var visibleEntries = await db.FeedEntries
            .Where(e => e.ActorId == userId && e.EventType == Subjects.HabitCreated)
            .ToListAsync(CT);
        Assert.Single(visibleEntries);
        Assert.Equal(habitId2, visibleEntries[0].Data!.RootElement.GetProperty("habitId").GetGuid());
    }

    // --- Friend Removed ---

    [Fact]
    public async Task FriendRemoved_SoftDeletesFriendshipEntries()
    {
        var userId1 = Guid.NewGuid();
        var userId2 = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create friendship entries
        await publisher.PublishAsync(Subjects.FriendRequestAccepted,
            new FriendRequestAcceptedEvent(userId1, userId2), CT);
        await WaitForEntryAsync(userId1, Subjects.FriendRequestAccepted);
        await WaitForEntryAsync(userId2, Subjects.FriendRequestAccepted);

        // Remove friendship
        await publisher.PublishAsync(Subjects.FriendRemoved,
            new FriendRemovedEvent(userId1, userId2), CT);

        // Wait for soft-delete of friendship entries
        await WaitForSoftDeletedFriendshipAsync(userId1, userId2);

        // Entries should not appear in normal queries
        using var db = _fixture.CreateDbContext();
        var visibleCount = await db.FeedEntries.CountAsync(
            e => e.EventType == Subjects.FriendRequestAccepted
                && (e.ActorId == userId1 || e.ActorId == userId2), CT);
        Assert.Equal(0, visibleCount);

        // But should still exist as soft-deleted
        var totalCount = await db.FeedEntries.IgnoreQueryFilters().CountAsync(
            e => e.EventType == Subjects.FriendRequestAccepted
                && (e.ActorId == userId1 || e.ActorId == userId2), CT);
        Assert.Equal(2, totalCount);
    }

    [Fact]
    public async Task FriendRemoved_PublicHabitsRemainVisible()
    {
        var userId1 = Guid.NewGuid();
        var userId2 = Guid.NewGuid();
        var habitId = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create a habit entry for userId1
        await publisher.PublishAsync(Subjects.HabitCreated,
            new HabitCreatedEvent(userId1, habitId, "PublicHabit"), CT);
        await WaitForEntryAsync(userId1, Subjects.HabitCreated);

        // Remove friendship
        await publisher.PublishAsync(Subjects.FriendRemoved,
            new FriendRemovedEvent(userId1, userId2), CT);

        // Give time for event processing
        await Task.Delay(500, CT);

        // Habit entry should still be visible (public habits remain visible)
        using var db = _fixture.CreateDbContext();
        var count = await db.FeedEntries.CountAsync(
            e => e.ActorId == userId1 && e.EventType == Subjects.HabitCreated, CT);
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task FriendRemoved_IdempotentUnderRedelivery()
    {
        var userId1 = Guid.NewGuid();
        var userId2 = Guid.NewGuid();
        var publisher = _fixture.GetPublisher();

        // Create friendship entries
        await publisher.PublishAsync(Subjects.FriendRequestAccepted,
            new FriendRequestAcceptedEvent(userId1, userId2), CT);
        await WaitForEntryAsync(userId1, Subjects.FriendRequestAccepted);
        await WaitForEntryAsync(userId2, Subjects.FriendRequestAccepted);

        // Remove friendship twice (simulating redelivery)
        await publisher.PublishAsync(Subjects.FriendRemoved,
            new FriendRemovedEvent(userId1, userId2), CT);
        await WaitForSoftDeletedFriendshipAsync(userId1, userId2);

        await publisher.PublishAsync(Subjects.FriendRemoved,
            new FriendRemovedEvent(userId1, userId2), CT);
        await Task.Delay(500, CT);

        // Should still have exactly 2 soft-deleted entries
        using var db = _fixture.CreateDbContext();
        var totalCount = await db.FeedEntries.IgnoreQueryFilters().CountAsync(
            e => e.EventType == Subjects.FriendRequestAccepted
                && (e.ActorId == userId1 || e.ActorId == userId2), CT);
        Assert.Equal(2, totalCount);
    }

    // --- Helpers ---

    private async Task WaitForRestoredAsync(Guid actorId, string eventType, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            // Entry exists AND deleted_at is null (restored from soft-delete)
            if (await db.FeedEntries.AnyAsync(
                e => e.ActorId == actorId && e.EventType == eventType, CT))
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for restored entry with ActorId={actorId}, EventType={eventType}");
    }

    private async Task WaitForSoftDeletedAsync(Guid actorId, string eventType, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            if (await db.FeedEntries.IgnoreQueryFilters().AnyAsync(
                e => e.ActorId == actorId && e.EventType == eventType && e.DeletedAt != null, CT))
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for soft-deleted entry with ActorId={actorId}, EventType={eventType}");
    }

    private async Task WaitForSoftDeletedFriendshipAsync(Guid userId1, Guid userId2, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            var softDeleted = await db.FeedEntries.IgnoreQueryFilters().CountAsync(
                e => e.EventType == Subjects.FriendRequestAccepted
                    && (e.ActorId == userId1 || e.ActorId == userId2)
                    && e.DeletedAt != null, CT);
            if (softDeleted >= 2)
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for soft-deleted friendship entries between {userId1} and {userId2}");
    }

    private async Task WaitForEntryAsync(Guid actorId, string eventType, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            if (await db.FeedEntries.AnyAsync(e => e.ActorId == actorId && e.EventType == eventType, CT))
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for feed entry with ActorId={actorId}, EventType={eventType}");
    }

    private async Task WaitForCountAsync(Guid actorId, int expectedCount, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            var count = await db.FeedEntries.CountAsync(e => e.ActorId == actorId, CT);
            if (count == expectedCount)
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for ActorId={actorId} to have {expectedCount} entries");
    }
}
