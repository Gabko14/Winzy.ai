using Microsoft.EntityFrameworkCore;
using Winzy.ChallengeService.Entities;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Xunit;

namespace Winzy.ChallengeService.Tests;

public class HabitCompletedSubscriberTests : IClassFixture<ChallengeServiceFixture>, IAsyncLifetime
{
    private readonly ChallengeServiceFixture _fixture;
    private readonly Guid _creatorId = Guid.NewGuid();
    private readonly Guid _recipientId = Guid.NewGuid();
    private readonly Guid _habitId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public HabitCompletedSubscriberTests(ChallengeServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // ============================================================
    // DaysInPeriod — date validation
    // ============================================================

    [Fact]
    public async Task DaysInPeriod_CompletionAfterCreation_IncrementsCount()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.DaysInPeriod,
            createdAt: new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 5, 12, 0, 0, DateTimeKind.Utc), 0.5), CT);

        await WaitForCompletionCountAsync(challengeId, 1);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(1, challenge.CompletionCount);
    }

    [Fact]
    public async Task DaysInPeriod_CompletionBeforeCreation_DoesNotIncrementCount()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.DaysInPeriod,
            createdAt: new DateTimeOffset(2026, 3, 10, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        // Completion dated before challenge was created
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 5, 12, 0, 0, DateTimeKind.Utc), 0.5), CT);

        // Give subscriber time to process (and skip) the event
        await Task.Delay(1500, CT);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(0, challenge.CompletionCount);
    }

    [Fact]
    public async Task DaysInPeriod_CompletionOnCreationDate_IncrementsCount()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.DaysInPeriod,
            createdAt: new DateTimeOffset(2026, 3, 5, 14, 30, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        // Same date but earlier time — should still count (date-level comparison)
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 5, 8, 0, 0, DateTimeKind.Utc), 0.5), CT);

        await WaitForCompletionCountAsync(challengeId, 1);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(1, challenge.CompletionCount);
    }

    // ============================================================
    // TotalCompletions — date validation
    // ============================================================

    [Fact]
    public async Task TotalCompletions_CompletionBeforeCreation_DoesNotIncrementCount()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.TotalCompletions,
            createdAt: new DateTimeOffset(2026, 3, 10, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 1, 12, 0, 0, DateTimeKind.Utc), 0.5), CT);

        await Task.Delay(1500, CT);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(0, challenge.CompletionCount);
    }

    [Fact]
    public async Task TotalCompletions_CompletionAfterCreation_IncrementsCount()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.TotalCompletions,
            createdAt: new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 15, 12, 0, 0, DateTimeKind.Utc), 0.5), CT);

        await WaitForCompletionCountAsync(challengeId, 1);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(1, challenge.CompletionCount);
    }

    // ============================================================
    // CustomDateRange — date validation
    // ============================================================

    [Fact]
    public async Task CustomDateRange_CompletionBeforeCustomStart_DoesNotUpdateProgress()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.CustomDateRange,
            createdAt: new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero),
            customStartDate: new DateTimeOffset(2026, 3, 15, 0, 0, 0, TimeSpan.Zero),
            customEndDate: new DateTimeOffset(2026, 4, 15, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        // Completion is after challenge creation but before custom start date
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 10, 12, 0, 0, DateTimeKind.Utc), 0.9), CT);

        await Task.Delay(1500, CT);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(0, challenge.CurrentProgress);
    }

    [Fact]
    public async Task CustomDateRange_CompletionAfterCustomStart_UpdatesProgress()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.CustomDateRange,
            createdAt: new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero),
            customStartDate: new DateTimeOffset(2026, 3, 15, 0, 0, 0, TimeSpan.Zero),
            customEndDate: new DateTimeOffset(2026, 4, 15, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 20, 12, 0, 0, DateTimeKind.Utc), 0.5), CT);

        await WaitForProgressAsync(challengeId);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.True(challenge.CurrentProgress > 0);
    }

    [Fact]
    public async Task CustomDateRange_NoCustomStart_FallsBackToCreatedAt()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.CustomDateRange,
            createdAt: new DateTimeOffset(2026, 3, 10, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        // Before creation date
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 5, 12, 0, 0, DateTimeKind.Utc), 0.9), CT);

        await Task.Delay(1500, CT);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(0, challenge.CurrentProgress);
    }

    // ============================================================
    // ImprovementMilestone — date validation
    // ============================================================

    [Fact]
    public async Task Improvement_CompletionBeforeCreation_DoesNotCaptureBaseline()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.ImprovementMilestone,
            createdAt: new DateTimeOffset(2026, 3, 10, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 5, 12, 0, 0, DateTimeKind.Utc), 0.3), CT);

        await Task.Delay(1500, CT);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Null(challenge.BaselineConsistency);
        Assert.Equal(0, challenge.CurrentProgress);
    }

    [Fact]
    public async Task Improvement_CompletionAfterCreation_CapturesBaseline()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.ImprovementMilestone,
            createdAt: new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 5, 12, 0, 0, DateTimeKind.Utc), 0.45), CT);

        await WaitForBaselineAsync(challengeId);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.Equal(0.45, challenge.BaselineConsistency);
    }

    // ============================================================
    // ConsistencyTarget — no date gate needed (consistency is live)
    // ============================================================

    [Fact]
    public async Task ConsistencyTarget_AlwaysUpdatesProgress()
    {
        var challengeId = await SeedChallengeAsync(
            MilestoneType.ConsistencyTarget,
            createdAt: new DateTimeOffset(2026, 3, 10, 0, 0, 0, TimeSpan.Zero));

        var publisher = _fixture.GetPublisher();
        // Even with a date before creation, consistency targets use live consistency value
        await publisher.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(_recipientId, _habitId, new DateTime(2026, 3, 5, 12, 0, 0, DateTimeKind.Utc), 0.5), CT);

        await WaitForProgressAsync(challengeId);

        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        Assert.True(challenge.CurrentProgress > 0);
    }

    // ============================================================
    // Helpers
    // ============================================================

    private async Task<Guid> SeedChallengeAsync(
        MilestoneType milestoneType,
        DateTimeOffset createdAt,
        double targetValue = 80.0,
        int periodDays = 30,
        DateTimeOffset? customStartDate = null,
        DateTimeOffset? customEndDate = null)
    {
        using var db = _fixture.CreateDbContext();
        var challenge = new Challenge
        {
            Id = Guid.NewGuid(),
            HabitId = _habitId,
            CreatorId = _creatorId,
            RecipientId = _recipientId,
            MilestoneType = milestoneType,
            TargetValue = targetValue,
            PeriodDays = periodDays,
            RewardDescription = "Test reward",
            Status = ChallengeStatus.Active,
            EndsAt = DateTimeOffset.UtcNow.AddDays(periodDays),
            CustomStartDate = customStartDate,
            CustomEndDate = customEndDate,
        };

        db.Challenges.Add(challenge);
        await db.SaveChangesAsync(CT);

        // BaseDbContext.SetTimestamps() overwrites CreatedAt on Added entities,
        // so we must set the desired CreatedAt via raw SQL after the initial save.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE challenges SET created_at = {createdAt} WHERE id = {challenge.Id}", CT);

        return challenge.Id;
    }

    private async Task WaitForCompletionCountAsync(Guid challengeId, int expectedCount, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            if (challenge.CompletionCount == expectedCount)
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for ChallengeId={challengeId} to have CompletionCount={expectedCount}");
    }

    private async Task WaitForProgressAsync(Guid challengeId, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            if (challenge.CurrentProgress > 0)
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for ChallengeId={challengeId} to have progress > 0");
    }

    private async Task WaitForBaselineAsync(Guid challengeId, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            if (challenge.BaselineConsistency is not null)
                return;
            await Task.Delay(100, CT);
        }

        throw new TimeoutException(
            $"Timed out waiting for ChallengeId={challengeId} to have BaselineConsistency set");
    }
}
