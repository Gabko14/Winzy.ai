using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.ChallengeService.Entities;
using Xunit;

namespace Winzy.ChallengeService.Tests;

public class ExportEndpointTests : IClassFixture<ChallengeServiceFixture>, IAsyncLifetime
{
    private readonly ChallengeServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _otherId = Guid.NewGuid();
    private readonly Guid _habitId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public ExportEndpointTests(ChallengeServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- Happy path ---

    [Fact]
    public async Task Export_WithChallenges_ReturnsFullData()
    {
        var now = DateTimeOffset.UtcNow;
        var challengeId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.Challenges.Add(new Challenge
            {
                Id = challengeId,
                HabitId = _habitId,
                CreatorId = _userId,
                RecipientId = _otherId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80.0,
                PeriodDays = 30,
                RewardDescription = "Coffee together!",
                Status = ChallengeStatus.Active,
                EndsAt = now.AddDays(30),
                CreatedAt = now.AddDays(-5),
                UpdatedAt = now.AddDays(-5)
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/challenges/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("challenge", body.GetProperty("service").GetString());

        var challenges = body.GetProperty("data").GetProperty("challenges");
        Assert.Equal(1, challenges.GetArrayLength());

        var c = challenges[0];
        Assert.Equal(challengeId, c.GetProperty("challengeId").GetGuid());
        Assert.Equal(_userId, c.GetProperty("fromUserId").GetGuid());
        Assert.Equal(_otherId, c.GetProperty("toUserId").GetGuid());
        Assert.Equal(_habitId, c.GetProperty("habitId").GetGuid());
        Assert.Equal("Coffee together!", c.GetProperty("reward").GetString());
    }

    [Fact]
    public async Task Export_IncludesChallengesWhereUserIsRecipient()
    {
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.Challenges.Add(new Challenge
            {
                Id = Guid.NewGuid(),
                HabitId = _habitId,
                CreatorId = _otherId,
                RecipientId = _userId,
                MilestoneType = MilestoneType.DaysInPeriod,
                TargetValue = 20,
                PeriodDays = 30,
                RewardDescription = "Tennis match",
                Status = ChallengeStatus.Completed,
                EndsAt = now.AddDays(10),
                CompletedAt = now.AddDays(-1),
                CreatedAt = now.AddDays(-20),
                UpdatedAt = now.AddDays(-1)
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/challenges/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challenges = body.GetProperty("data").GetProperty("challenges");
        Assert.Equal(1, challenges.GetArrayLength());
        Assert.Equal(_userId, challenges[0].GetProperty("toUserId").GetGuid());
    }

    [Fact]
    public async Task Export_MultipleChallenges_OrderedByCreatedAtDescending()
    {
        var now = DateTimeOffset.UtcNow;
        var habitId2 = Guid.NewGuid();
        var olderId = Guid.NewGuid();
        var newerId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.Challenges.AddRange(
                new Challenge
                {
                    Id = olderId,
                    HabitId = _habitId,
                    CreatorId = _userId,
                    RecipientId = _otherId,
                    MilestoneType = MilestoneType.ConsistencyTarget,
                    TargetValue = 80.0,
                    PeriodDays = 30,
                    RewardDescription = "Older challenge",
                    Status = ChallengeStatus.Active,
                    EndsAt = now.AddDays(30),
                },
                new Challenge
                {
                    Id = newerId,
                    HabitId = habitId2,
                    CreatorId = _userId,
                    RecipientId = _otherId,
                    MilestoneType = MilestoneType.TotalCompletions,
                    TargetValue = 50,
                    PeriodDays = 60,
                    RewardDescription = "Newer challenge",
                    Status = ChallengeStatus.Active,
                    EndsAt = now.AddDays(60),
                });
            await db.SaveChangesAsync(CT);

            // BaseDbContext.SetTimestamps overrides CreatedAt on save, so use raw SQL
            await db.Database.ExecuteSqlAsync(
                $"UPDATE challenges SET created_at = NOW() - INTERVAL '10 days' WHERE id = {olderId}", CT);
            await db.Database.ExecuteSqlAsync(
                $"UPDATE challenges SET created_at = NOW() - INTERVAL '2 days' WHERE id = {newerId}", CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/challenges/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challenges = body.GetProperty("data").GetProperty("challenges");
        Assert.Equal(2, challenges.GetArrayLength());
        Assert.Equal("Newer challenge", challenges[0].GetProperty("reward").GetString());
        Assert.Equal("Older challenge", challenges[1].GetProperty("reward").GetString());
    }

    // --- Edge cases / Error conditions ---

    [Fact]
    public async Task Export_NoChallenges_Returns404()
    {
        var unknownUserId = Guid.NewGuid();

        using var client = _fixture.CreateAuthenticatedClient(unknownUserId);
        var response = await client.GetAsync($"/challenges/internal/export/{unknownUserId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Export_DoesNotReturnOtherUsersChallenges()
    {
        var thirdUserId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.Challenges.Add(new Challenge
            {
                Id = Guid.NewGuid(),
                HabitId = _habitId,
                CreatorId = _otherId,
                RecipientId = thirdUserId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80.0,
                PeriodDays = 30,
                RewardDescription = "Not my challenge",
                Status = ChallengeStatus.Active,
                EndsAt = now.AddDays(30),
                CreatedAt = now,
                UpdatedAt = now
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/challenges/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
