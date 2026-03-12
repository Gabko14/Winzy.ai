using Microsoft.EntityFrameworkCore;
using Winzy.ChallengeService.Entities;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Xunit;

namespace Winzy.ChallengeService.Tests;

public class UserDeletedSubscriberTests : IClassFixture<ChallengeServiceFixture>, IAsyncLifetime
{
    private readonly ChallengeServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _otherUserId = Guid.NewGuid();
    private readonly Guid _habitId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public UserDeletedSubscriberTests(ChallengeServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task UserDeleted_DeletesActiveChallenges()
    {
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Active);

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId), CT);

        await WaitForNoChallengesAsync(_userId);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.Challenges
            .Where(c => c.CreatorId == _userId || c.RecipientId == _userId)
            .CountAsync(CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UserDeleted_DeletesCompletedChallenges()
    {
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Completed);

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId), CT);

        await WaitForNoChallengesAsync(_userId);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.Challenges
            .Where(c => c.CreatorId == _userId || c.RecipientId == _userId)
            .CountAsync(CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UserDeleted_DeletesClaimedChallenges()
    {
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Claimed);

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId), CT);

        await WaitForNoChallengesAsync(_userId);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.Challenges
            .Where(c => c.CreatorId == _userId || c.RecipientId == _userId)
            .CountAsync(CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UserDeleted_DeletesCancelledChallenges()
    {
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Cancelled);

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId), CT);

        await WaitForNoChallengesAsync(_userId);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.Challenges
            .Where(c => c.CreatorId == _userId || c.RecipientId == _userId)
            .CountAsync(CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UserDeleted_DeletesAllStates_AsRecipient()
    {
        // User is the recipient, not creator
        await SeedChallengeAsync(_otherUserId, _userId, ChallengeStatus.Active);
        await SeedChallengeAsync(_otherUserId, _userId, ChallengeStatus.Completed, habitId: Guid.NewGuid());

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId), CT);

        await WaitForNoChallengesAsync(_userId);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.Challenges
            .Where(c => c.CreatorId == _userId || c.RecipientId == _userId)
            .CountAsync(CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UserDeleted_DeletesAllStatusesTogether()
    {
        // Seed one of each status
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Active, Guid.NewGuid());
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Completed, Guid.NewGuid());
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Claimed, Guid.NewGuid());
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Cancelled, Guid.NewGuid());

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId), CT);

        await WaitForNoChallengesAsync(_userId);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.Challenges
            .Where(c => c.CreatorId == _userId || c.RecipientId == _userId)
            .CountAsync(CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UserDeleted_DoesNotAffectOtherUsersChallenges()
    {
        var thirdUser = Guid.NewGuid();
        // Challenge between other users
        await SeedChallengeAsync(_otherUserId, thirdUser, ChallengeStatus.Active, Guid.NewGuid());
        // Challenge involving the deleted user
        await SeedChallengeAsync(_userId, _otherUserId, ChallengeStatus.Active, Guid.NewGuid());

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.UserDeleted, new UserDeletedEvent(_userId), CT);

        await WaitForNoChallengesAsync(_userId);

        using var db = _fixture.CreateDbContext();
        // The other users' challenge should still exist
        var otherChallenges = await db.Challenges
            .Where(c => c.CreatorId == _otherUserId && c.RecipientId == thirdUser)
            .CountAsync(CT);
        Assert.Equal(1, otherChallenges);
    }

    // --- Helpers ---

    private async Task SeedChallengeAsync(Guid creatorId, Guid recipientId, ChallengeStatus status, Guid? habitId = null)
    {
        using var db = _fixture.CreateDbContext();
        db.Challenges.Add(new Challenge
        {
            CreatorId = creatorId,
            RecipientId = recipientId,
            HabitId = habitId ?? _habitId,
            MilestoneType = MilestoneType.ConsistencyTarget,
            TargetValue = 80,
            PeriodDays = 30,
            RewardDescription = $"Test {status}",
            Status = status,
            EndsAt = DateTimeOffset.UtcNow.AddDays(30),
            CompletedAt = status is ChallengeStatus.Completed or ChallengeStatus.Claimed ? DateTimeOffset.UtcNow : null,
            ClaimedAt = status == ChallengeStatus.Claimed ? DateTimeOffset.UtcNow : null
        });
        await db.SaveChangesAsync(CT);
    }

    private async Task WaitForNoChallengesAsync(Guid userId, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            var count = await db.Challenges
                .Where(c => c.CreatorId == userId || c.RecipientId == userId)
                .CountAsync(CT);
            if (count == 0)
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for UserId={userId} to have 0 challenges");
    }
}
