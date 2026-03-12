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

    // --- Helpers ---

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
