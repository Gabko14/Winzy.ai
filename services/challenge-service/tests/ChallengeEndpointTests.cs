using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.ChallengeService.Entities;
using Xunit;

namespace Winzy.ChallengeService.Tests;

public class ChallengeEndpointTests : IClassFixture<ChallengeServiceFixture>, IAsyncLifetime
{
    private readonly ChallengeServiceFixture _fixture;
    private readonly Guid _creatorId = Guid.NewGuid();
    private readonly Guid _recipientId = Guid.NewGuid();
    private readonly Guid _habitId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public ChallengeEndpointTests(ChallengeServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync()
    {
        await _fixture.ResetDataAsync();
        _fixture.SocialHandler.AddFriendship(_creatorId, _recipientId);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- POST /challenges ---

    [Fact]
    public async Task CreateChallenge_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Let's grab coffee together!"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(_habitId, body.GetProperty("habitId").GetGuid());
        Assert.Equal(_creatorId, body.GetProperty("creatorId").GetGuid());
        Assert.Equal(_recipientId, body.GetProperty("recipientId").GetGuid());
        Assert.Equal("consistencyTarget", body.GetProperty("milestoneType").GetString());
        Assert.Equal(80.0, body.GetProperty("targetValue").GetDouble());
        Assert.Equal(30, body.GetProperty("periodDays").GetInt32());
        Assert.Equal("Let's grab coffee together!", body.GetProperty("rewardDescription").GetString());
        Assert.Equal("active", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task CreateChallenge_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_SelfChallenge_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _creatorId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Self challenge"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Cannot challenge yourself", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_NotFriends_Returns400()
    {
        var strangerId = Guid.NewGuid();
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = strangerId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Not friends"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("You can only challenge friends", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_MissingRewardDescription_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = ""
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_InvalidTargetValue_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 0.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_TargetValueOver100_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 101.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_InvalidPeriodDays_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 0,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_PeriodDaysOver365_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 366,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_EmptyHabitId_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = Guid.Empty,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- GET /challenges ---

    [Fact]
    public async Task ListChallenges_ReturnsSentAndReceived()
    {
        using var creatorClient = _fixture.CreateAuthenticatedClient(_creatorId);
        using var recipientClient = _fixture.CreateAuthenticatedClient(_recipientId);

        // Creator sends a challenge
        await creatorClient.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        // Creator should see it as sender
        var creatorResponse = await creatorClient.GetAsync("/challenges", CT);
        Assert.Equal(HttpStatusCode.OK, creatorResponse.StatusCode);
        var creatorBody = await creatorResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var creatorItems = creatorBody.GetProperty("items");
        Assert.Equal(1, creatorItems.GetArrayLength());

        // Recipient should see it as receiver
        var recipientResponse = await recipientClient.GetAsync("/challenges", CT);
        Assert.Equal(HttpStatusCode.OK, recipientResponse.StatusCode);
        var recipientBody = await recipientResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var recipientItems = recipientBody.GetProperty("items");
        Assert.Equal(1, recipientItems.GetArrayLength());
    }

    [Fact]
    public async Task ListChallenges_OtherUser_DoesNotSee()
    {
        using var creatorClient = _fixture.CreateAuthenticatedClient(_creatorId);

        await creatorClient.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        // Third-party user should not see this challenge
        var otherUserId = Guid.NewGuid();
        using var otherClient = _fixture.CreateAuthenticatedClient(otherUserId);
        var response = await otherClient.GetAsync("/challenges", CT);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(0, items.GetArrayLength());
    }

    // --- GET /challenges?status=...&since=... ---

    [Fact]
    public async Task ListChallenges_StatusFilter_ReturnsOnlyMatching()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // Create a challenge (active)
        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        // Filtering by "completed" should return nothing (challenge is active)
        var response = await client.GetAsync("/challenges?status=completed", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
        Assert.Equal(0, body.GetProperty("total").GetInt32());

        // Filtering by "active" should return the challenge
        response = await client.GetAsync("/challenges?status=active", CT);
        body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
        Assert.Equal(1, body.GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task ListChallenges_StatusFilterCaseInsensitive()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        // Mixed case should still work
        var response = await client.GetAsync("/challenges?status=Active", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ListChallenges_InvalidStatusFilter_ReturnsAll()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        // Invalid status value should be ignored — returns all
        var response = await client.GetAsync("/challenges?status=nonsense", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ListChallenges_SinceFilter_FiltersOlderChallenges()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        // Since filter set to the future — should return nothing
        var futureDate = DateTimeOffset.UtcNow.AddHours(1).ToString("o");
        var response = await client.GetAsync($"/challenges?since={Uri.EscapeDataString(futureDate)}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());

        // Since filter set to the past — should return the challenge
        var pastDate = DateTimeOffset.UtcNow.AddHours(-1).ToString("o");
        response = await client.GetAsync($"/challenges?since={Uri.EscapeDataString(pastDate)}", CT);
        body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ListChallenges_StatusAndSinceCombined()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        var pastDate = DateTimeOffset.UtcNow.AddHours(-1).ToString("o");

        // status=active + since=past -> should return the challenge
        var response = await client.GetAsync($"/challenges?status=active&since={Uri.EscapeDataString(pastDate)}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());

        // status=completed + since=past -> should return nothing (challenge is active)
        response = await client.GetAsync($"/challenges?status=completed&since={Uri.EscapeDataString(pastDate)}", CT);
        body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    // --- GET /challenges — EffectiveStatus contract regression tests ---

    [Fact]
    public async Task ListChallenges_OverdueActiveChallenge_ExcludedFromActiveFilter()
    {
        // Seed an overdue-active challenge directly in DB:
        // Status = Active but EndsAt is in the past — EffectiveStatus returns "expired"
        var challengeId = Guid.NewGuid();
        {
            using var db = _fixture.CreateDbContext();
            db.Challenges.Add(new Challenge
            {
                Id = challengeId,
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Overdue coffee",
                Status = ChallengeStatus.Active,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-1), // expired yesterday
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // ?status=active must NOT include the overdue-active challenge
        var response = await client.GetAsync("/challenges?status=active", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
        Assert.Equal(0, body.GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task ListChallenges_OverdueActiveChallenge_IncludedInExpiredFilter()
    {
        // Seed an overdue-active challenge directly in DB
        var challengeId = Guid.NewGuid();
        {
            using var db = _fixture.CreateDbContext();
            db.Challenges.Add(new Challenge
            {
                Id = challengeId,
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Overdue coffee",
                Status = ChallengeStatus.Active,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-1),
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // ?status=expired must include the overdue-active challenge
        var response = await client.GetAsync("/challenges?status=expired", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
        Assert.Equal(1, body.GetProperty("total").GetInt32());

        // The returned item's status field must say "expired", not "active"
        var item = body.GetProperty("items")[0];
        Assert.Equal("expired", item.GetProperty("status").GetString());
    }

    [Fact]
    public async Task ListChallenges_OverdueActiveChallenge_ExpiredFilterWithSince()
    {
        // Seed an overdue-active challenge with a known UpdatedAt
        var challengeId = Guid.NewGuid();
        {
            using var db = _fixture.CreateDbContext();
            db.Challenges.Add(new Challenge
            {
                Id = challengeId,
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Overdue coffee",
                Status = ChallengeStatus.Active,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-1),
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // status=expired + since=past -> should include the overdue-active challenge
        var pastDate = DateTimeOffset.UtcNow.AddHours(-1).ToString("o");
        var response = await client.GetAsync($"/challenges?status=expired&since={Uri.EscapeDataString(pastDate)}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());

        // status=active + since=past -> should NOT include it
        response = await client.GetAsync($"/challenges?status=active&since={Uri.EscapeDataString(pastDate)}", CT);
        body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());

        // status=expired + since=future -> should return nothing (UpdatedAt is in the past)
        var futureDate = DateTimeOffset.UtcNow.AddHours(1).ToString("o");
        response = await client.GetAsync($"/challenges?status=expired&since={Uri.EscapeDataString(futureDate)}", CT);
        body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ListChallenges_MixedStatuses_FilterReturnsCorrectBuckets()
    {
        // Seed three challenges: one truly active, one overdue-active, one DB-expired
        {
            using var db = _fixture.CreateDbContext();

            // Truly active (EndsAt in the future)
            db.Challenges.Add(new Challenge
            {
                Id = Guid.NewGuid(),
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Active challenge",
                Status = ChallengeStatus.Active,
                EndsAt = DateTimeOffset.UtcNow.AddDays(10),
            });

            // Overdue-active (Status=Active but EndsAt in the past)
            db.Challenges.Add(new Challenge
            {
                Id = Guid.NewGuid(),
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = Guid.NewGuid(), // different habit to avoid unique constraint
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Overdue challenge",
                Status = ChallengeStatus.Active,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-5),
            });

            // DB-expired (Status already set to Expired)
            db.Challenges.Add(new Challenge
            {
                Id = Guid.NewGuid(),
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = Guid.NewGuid(),
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Expired challenge",
                Status = ChallengeStatus.Expired,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-10),
            });

            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // ?status=active -> only the truly active one
        var response = await client.GetAsync("/challenges?status=active", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(1, body.GetProperty("total").GetInt32());
        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
        Assert.Equal("active", body.GetProperty("items")[0].GetProperty("status").GetString());

        // ?status=expired -> both the overdue-active and the DB-expired
        response = await client.GetAsync("/challenges?status=expired", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(2, body.GetProperty("total").GetInt32());
        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
        foreach (var item in body.GetProperty("items").EnumerateArray())
        {
            Assert.Equal("expired", item.GetProperty("status").GetString());
        }

        // No filter -> all 3
        response = await client.GetAsync("/challenges", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(3, body.GetProperty("total").GetInt32());
        Assert.Equal(3, body.GetProperty("items").GetArrayLength());
    }

    // --- GET /challenges/{id} ---

    [Fact]
    public async Task GetChallenge_ExistingChallenge_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        var response = await client.GetAsync($"/challenges/{challengeId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Coffee", body.GetProperty("rewardDescription").GetString());
        Assert.True(body.TryGetProperty("progress", out var progress));
        Assert.Equal(0, progress.GetDouble());
    }

    [Fact]
    public async Task GetChallenge_OtherUsersChallenge_Returns404()
    {
        using var creatorClient = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await creatorClient.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        var otherUserId = Guid.NewGuid();
        using var otherClient = _fixture.CreateAuthenticatedClient(otherUserId);
        var response = await otherClient.GetAsync($"/challenges/{challengeId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetChallenge_NonExistentId_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.GetAsync($"/challenges/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- PUT /challenges/{id}/claim ---

    [Fact]
    public async Task ClaimChallenge_ActiveChallenge_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        var response = await client.PutAsJsonAsync($"/challenges/{challengeId}/claim", new { }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Only completed challenges can be claimed", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ClaimChallenge_CompletedChallenge_Returns200_AndSetsClaimedStatus()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee time!"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        // Manually set status to completed in DB
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            challenge.Status = ChallengeStatus.Completed;
            challenge.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(CT);
        }

        var response = await client.PutAsJsonAsync($"/challenges/{challengeId}/claim", new { }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("claimed", body.GetProperty("status").GetString());
        Assert.True(body.TryGetProperty("claimedAt", out var claimedAt));
        Assert.NotEqual(JsonValueKind.Null, claimedAt.ValueKind);

        // Verify persisted in DB
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            Assert.Equal(ChallengeStatus.Claimed, challenge.Status);
            Assert.NotNull(challenge.ClaimedAt);
        }
    }

    [Fact]
    public async Task ClaimChallenge_AlreadyClaimed_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        // Set to completed, then claim
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            challenge.Status = ChallengeStatus.Completed;
            challenge.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(CT);
        }

        // First claim succeeds
        await client.PutAsJsonAsync($"/challenges/{challengeId}/claim", new { }, CT);

        // Second claim should fail — already claimed
        var response = await client.PutAsJsonAsync($"/challenges/{challengeId}/claim", new { }, CT);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ClaimChallenge_NonExistentChallenge_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PutAsJsonAsync($"/challenges/{Guid.NewGuid()}/claim", new { }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- DELETE /challenges/{id} ---

    [Fact]
    public async Task CancelChallenge_ActiveChallenge_Returns204()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        var response = await client.DeleteAsync($"/challenges/{challengeId}", CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Verify status is cancelled in DB
        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstOrDefaultAsync(c => c.Id == challengeId, CT);
        Assert.NotNull(challenge);
        Assert.Equal(ChallengeStatus.Cancelled, challenge!.Status);
    }

    [Fact]
    public async Task CancelChallenge_CompletedChallenge_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        // Manually complete it
        using var db = _fixture.CreateDbContext();
        var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
        challenge.Status = ChallengeStatus.Completed;
        challenge.CompletedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(CT);

        var response = await client.DeleteAsync($"/challenges/{challengeId}", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CancelChallenge_RecipientCannotCancel_Returns404()
    {
        using var creatorClient = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await creatorClient.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        // Recipient should not be able to cancel
        using var recipientClient = _fixture.CreateAuthenticatedClient(_recipientId);
        var response = await recipientClient.DeleteAsync($"/challenges/{challengeId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CancelChallenge_NonExistentChallenge_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.DeleteAsync($"/challenges/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- Milestone type validation ---

    [Fact]
    public async Task CreateChallenge_DaysInPeriod_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 1, // DaysInPeriod
            targetValue = 20.0,
            periodDays = 30,
            rewardDescription = "Coffee for completing 20 days!"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("daysInPeriod", body.GetProperty("milestoneType").GetString());
        Assert.Equal(20.0, body.GetProperty("targetValue").GetDouble());
    }

    [Fact]
    public async Task CreateChallenge_DaysInPeriod_TargetExceedsPeriod_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 1, // DaysInPeriod
            targetValue = 31.0, // exceeds periodDays=30
            periodDays = 30,
            rewardDescription = "Impossible target"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_TotalCompletions_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 2, // TotalCompletions
            targetValue = 500.0,
            periodDays = 365,
            rewardDescription = "500 meditation sessions!"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("totalCompletions", body.GetProperty("milestoneType").GetString());
        Assert.Equal(500.0, body.GetProperty("targetValue").GetDouble());
    }

    [Fact]
    public async Task CreateChallenge_TotalCompletions_Over10000_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 2, // TotalCompletions
            targetValue = 10001.0,
            periodDays = 365,
            rewardDescription = "Too many"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_CustomDateRange_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var startDate = DateTimeOffset.UtcNow.AddDays(1);
        var endDate = DateTimeOffset.UtcNow.AddDays(31);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 3, // CustomDateRange
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "March consistency goal!",
            customStartDate = startDate,
            customEndDate = endDate
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("customDateRange", body.GetProperty("milestoneType").GetString());
    }

    [Fact]
    public async Task CreateChallenge_CustomDateRange_MissingDates_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 3, // CustomDateRange
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "Missing dates"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("CustomStartDate", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_CustomDateRange_EndBeforeStart_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 3, // CustomDateRange
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "Bad dates",
            customStartDate = DateTimeOffset.UtcNow.AddDays(10),
            customEndDate = DateTimeOffset.UtcNow.AddDays(5)
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("after", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_CustomDateRange_EndInPast_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 3, // CustomDateRange
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "Past end",
            customStartDate = DateTimeOffset.UtcNow.AddDays(-10),
            customEndDate = DateTimeOffset.UtcNow.AddDays(-1)
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("future", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_ImprovementMilestone_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 4, // ImprovementMilestone
            targetValue = 20.0,
            periodDays = 60,
            rewardDescription = "Improve by 20%!"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("improvementMilestone", body.GetProperty("milestoneType").GetString());
    }

    [Fact]
    public async Task CreateChallenge_ImprovementMilestone_Over100_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 4, // ImprovementMilestone
            targetValue = 101.0,
            periodDays = 60,
            rewardDescription = "Too much improvement"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_InvalidMilestoneType_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 99, // Invalid
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Bad type"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid MilestoneType", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task GetChallengeDetail_DaysInPeriod_ReturnsCompletionCount()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 1, // DaysInPeriod
            targetValue = 20.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        // Set some completion count in DB
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            challenge.CompletionCount = 10;
            challenge.CurrentProgress = 0.5;
            await db.SaveChangesAsync(CT);
        }

        var response = await client.GetAsync($"/challenges/{challengeId}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(10, body.GetProperty("completionCount").GetInt32());
        Assert.Equal(0.5, body.GetProperty("progress").GetDouble());
    }

    [Fact]
    public async Task GetChallengeDetail_ImprovementMilestone_ReturnsBaselineConsistency()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 4, // ImprovementMilestone
            targetValue = 20.0,
            periodDays = 60,
            rewardDescription = "Improve!"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        // Set baseline in DB
        {
            using var db = _fixture.CreateDbContext();
            var challenge = await db.Challenges.FirstAsync(c => c.Id == challengeId, CT);
            challenge.BaselineConsistency = 45.0;
            await db.SaveChangesAsync(CT);
        }

        var response = await client.GetAsync($"/challenges/{challengeId}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(45.0, body.GetProperty("baselineConsistency").GetDouble());
    }

    [Fact]
    public async Task GetChallengeDetail_CustomDateRange_ReturnsDateRange()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var startDate = DateTimeOffset.UtcNow.AddDays(1);
        var endDate = DateTimeOffset.UtcNow.AddDays(31);

        var createResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 3, // CustomDateRange
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "Date range challenge",
            customStartDate = startDate,
            customEndDate = endDate
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        var response = await client.GetAsync($"/challenges/{challengeId}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.TryGetProperty("customStartDate", out _));
        Assert.True(body.TryGetProperty("customEndDate", out _));
    }

    // --- String milestoneType deserialization (winzy.ai-1r4.1) ---

    [Fact]
    public async Task CreateChallenge_StringMilestoneType_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = "consistencyTarget",
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "String enum test"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("consistencyTarget", body.GetProperty("milestoneType").GetString());
    }

    [Fact]
    public async Task CreateChallenge_StringMilestoneType_DaysInPeriod_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = "daysInPeriod",
            targetValue = 20.0,
            periodDays = 30,
            rewardDescription = "String enum DaysInPeriod test"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("daysInPeriod", body.GetProperty("milestoneType").GetString());
    }

    // --- Friendship check integration (winzy.ai-1r4.1) ---

    [Fact]
    public async Task CreateChallenge_FriendshipCheckContract_MockMatchesRealRoute()
    {
        // Verify the mock handler responds on the same route the real Social Service exposes:
        // GET /social/internal/friends/{userId1}/{userId2}
        // The mock returns 200 for registered friendships, 404 otherwise — same as the real service.
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // With friendship registered (done in InitializeAsync) — should succeed
        var friendResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Friends test"
        }, CT);
        Assert.Equal(HttpStatusCode.Created, friendResponse.StatusCode);

        // Without friendship — should fail
        var strangerId = Guid.NewGuid();
        var strangerResponse = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = Guid.NewGuid(),
            recipientId = strangerId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Not friends test"
        }, CT);
        Assert.Equal(HttpStatusCode.BadRequest, strangerResponse.StatusCode);
        var body = await strangerResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("You can only challenge friends", body.GetProperty("error").GetString());
    }

    // --- Duplicate prevention (winzy.ai-3e4) ---

    [Fact]
    public async Task CreateChallenge_DuplicateActiveChallenge_Returns409()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // First creation succeeds
        var first = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "First challenge"
        }, CT);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        // Second creation for same triple should fail with 409
        var second = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 90.0,
            periodDays = 60,
            rewardDescription = "Duplicate challenge"
        }, CT);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var body = await second.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("active challenge already exists", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_ConcurrentDuplicates_OnlyOneSucceeds()
    {
        // Test that concurrent requests for the same triple don't both succeed
        var habitId = Guid.NewGuid();
        _fixture.SocialHandler.AddFriendship(_creatorId, _recipientId);

        var tasks = Enumerable.Range(0, 5).Select(_ =>
        {
            var client = _fixture.CreateAuthenticatedClient(_creatorId);
            return client.PostAsJsonAsync("/challenges", new
            {
                habitId,
                recipientId = _recipientId,
                milestoneType = 0,
                targetValue = 80.0,
                periodDays = 30,
                rewardDescription = "Concurrent test"
            }, CT);
        }).ToArray();

        var responses = await Task.WhenAll(tasks);
        var created = responses.Count(r => r.StatusCode == HttpStatusCode.Created);
        var conflicts = responses.Count(r => r.StatusCode == HttpStatusCode.Conflict);

        Assert.Equal(1, created);
        Assert.Equal(4, conflicts);
    }

    [Fact]
    public async Task CreateChallenge_AfterExpiredChallenge_Succeeds()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // Seed an expired challenge (Active but EndsAt in the past)
        {
            using var db = _fixture.CreateDbContext();
            db.Challenges.Add(new Challenge
            {
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 1,
                RewardDescription = "Old expired challenge",
                Status = ChallengeStatus.Active,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-1) // expired
            });
            await db.SaveChangesAsync(CT);
        }

        // Creating a new challenge for the same triple should succeed
        // because the endpoint expires stale Active challenges first
        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "New challenge after expiry"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        // Verify the old challenge was marked expired (not cancelled)
        using var verifyDb = _fixture.CreateDbContext();
        var allForTriple = await verifyDb.Challenges
            .Where(c => c.CreatorId == _creatorId && c.RecipientId == _recipientId && c.HabitId == _habitId)
            .ToListAsync(CT);
        Assert.Equal(2, allForTriple.Count);
        Assert.Single(allForTriple, c => c.Status == ChallengeStatus.Active);
        Assert.Single(allForTriple, c => c.Status == ChallengeStatus.Expired);
    }

    [Fact]
    public async Task CreateChallenge_AfterCompletedChallenge_Succeeds()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // Seed a completed challenge
        {
            using var db = _fixture.CreateDbContext();
            db.Challenges.Add(new Challenge
            {
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Completed challenge",
                Status = ChallengeStatus.Completed,
                EndsAt = DateTimeOffset.UtcNow.AddDays(10),
                CompletedAt = DateTimeOffset.UtcNow.AddDays(-1)
            });
            await db.SaveChangesAsync(CT);
        }

        // New challenge should succeed — completed challenges don't block the unique index
        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "New after completed"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // --- Reward description validation ---

    [Fact]
    public async Task CreateChallenge_RewardDescriptionTooLong_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = new string('a', 513)
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("512", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreateChallenge_RewardDescriptionWithHtml_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "<script>alert('xss')</script>"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- Friendship check error handling (winzy.ai-35k) ---

    [Fact]
    public async Task CreateChallenge_SocialServiceReturns500_Returns503()
    {
        _fixture.SocialHandler.ForceStatusCode = HttpStatusCode.InternalServerError;
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_SocialServiceReturns502_Returns503()
    {
        _fixture.SocialHandler.ForceStatusCode = HttpStatusCode.BadGateway;
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_SocialServiceTimeout_Returns503()
    {
        _fixture.SocialHandler.ForceTimeout = true;
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task CreateChallenge_NotFriends404_Returns400WithValidationError()
    {
        // Do NOT add friendship — MockSocialHandler returns 404 by default for unknown pairs
        var strangerId = Guid.NewGuid();
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = strangerId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee"
        }, CT);

        // 404 from Social Service = validation error (not friends), NOT 503
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("You can only challenge friends", body.GetProperty("error").GetString());
    }

    // --- Expired vs cancelled status preservation (winzy.ai-25m) ---

    [Fact]
    public async Task CreateChallenge_ReplacingExpired_PreservesExpiredStatus()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // Seed an expired challenge (Active but EndsAt in the past)
        Guid oldChallengeId;
        {
            using var db = _fixture.CreateDbContext();
            var old = new Challenge
            {
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 1,
                RewardDescription = "Old expired challenge",
                Status = ChallengeStatus.Active,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-1)
            };
            db.Challenges.Add(old);
            await db.SaveChangesAsync(CT);
            oldChallengeId = old.Id;
        }

        // Create replacement
        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "New replacement challenge"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        // Verify the old challenge is Expired (not Cancelled)
        using var verifyDb = _fixture.CreateDbContext();
        var verifiedOld = await verifyDb.Challenges.FindAsync([oldChallengeId], CT);
        Assert.NotNull(verifiedOld);
        Assert.Equal(ChallengeStatus.Expired, verifiedOld.Status);
    }

    [Fact]
    public async Task CreateChallenge_CancelledChallengeRetainsStatus_AfterNewCreation()
    {
        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // Seed a cancelled challenge
        Guid cancelledId;
        {
            using var db = _fixture.CreateDbContext();
            var cancelled = new Challenge
            {
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Cancelled challenge",
                Status = ChallengeStatus.Cancelled,
                EndsAt = DateTimeOffset.UtcNow.AddDays(10)
            };
            db.Challenges.Add(cancelled);
            await db.SaveChangesAsync(CT);
            cancelledId = cancelled.Id;
        }

        // Create a new challenge for the same triple — should succeed (cancelled doesn't block unique index)
        var response = await client.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 90.0,
            periodDays = 30,
            rewardDescription = "New challenge"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        // Verify the cancelled challenge still has Cancelled status (not overwritten)
        using var verifyDb = _fixture.CreateDbContext();
        var verifiedCancelled = await verifyDb.Challenges.FindAsync([cancelledId], CT);
        Assert.NotNull(verifiedCancelled);
        Assert.Equal(ChallengeStatus.Cancelled, verifiedCancelled.Status);
    }

    [Fact]
    public async Task GetChallenge_ExpiredVsCancelled_ShowsCorrectStatus()
    {
        // Seed both an expired and a cancelled challenge
        Guid expiredId, cancelledId;
        {
            using var db = _fixture.CreateDbContext();
            var expired = new Challenge
            {
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = _habitId,
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 1,
                RewardDescription = "Expired one",
                Status = ChallengeStatus.Expired,
                EndsAt = DateTimeOffset.UtcNow.AddDays(-1)
            };
            var cancelled = new Challenge
            {
                CreatorId = _creatorId,
                RecipientId = _recipientId,
                HabitId = Guid.NewGuid(), // different habit to avoid unique constraint
                MilestoneType = MilestoneType.ConsistencyTarget,
                TargetValue = 80,
                PeriodDays = 30,
                RewardDescription = "Cancelled one",
                Status = ChallengeStatus.Cancelled,
                EndsAt = DateTimeOffset.UtcNow.AddDays(10)
            };
            db.Challenges.AddRange(expired, cancelled);
            await db.SaveChangesAsync(CT);
            expiredId = expired.Id;
            cancelledId = cancelled.Id;
        }

        using var client = _fixture.CreateAuthenticatedClient(_creatorId);

        // Verify expired challenge shows "expired" status
        var expiredResponse = await client.GetAsync($"/challenges/{expiredId}", CT);
        Assert.Equal(HttpStatusCode.OK, expiredResponse.StatusCode);
        var expiredBody = await expiredResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("expired", expiredBody.GetProperty("status").GetString());

        // Verify cancelled challenge shows "cancelled" status
        var cancelledResponse = await client.GetAsync($"/challenges/{cancelledId}", CT);
        Assert.Equal(HttpStatusCode.OK, cancelledResponse.StatusCode);
        var cancelledBody = await cancelledResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("cancelled", cancelledBody.GetProperty("status").GetString());
    }

    // --- Creator display name enrichment ---

    [Fact]
    public async Task ListChallenges_IncludesCreatorDisplayName()
    {
        _fixture.AuthHandler.SetDisplayName(_creatorId, "Test Creator");

        using var creatorClient = _fixture.CreateAuthenticatedClient(_creatorId);
        await creatorClient.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee together"
        }, CT);

        using var recipientClient = _fixture.CreateAuthenticatedClient(_recipientId);
        var response = await recipientClient.GetAsync("/challenges", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal("Test Creator", items[0].GetProperty("creatorDisplayName").GetString());
    }

    [Fact]
    public async Task GetChallengeDetail_IncludesCreatorDisplayName()
    {
        _fixture.AuthHandler.SetDisplayName(_creatorId, "Detail Creator");

        using var creatorClient = _fixture.CreateAuthenticatedClient(_creatorId);
        var createResponse = await creatorClient.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee together"
        }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var challengeId = created.GetProperty("id").GetGuid();

        using var recipientClient = _fixture.CreateAuthenticatedClient(_recipientId);
        var response = await recipientClient.GetAsync($"/challenges/{challengeId}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Detail Creator", body.GetProperty("creatorDisplayName").GetString());
    }

    [Fact]
    public async Task ListChallenges_AuthServiceDown_ReturnsNullCreatorDisplayName()
    {
        // Don't set any display names — MockAuthHandler returns empty profiles for unknown IDs
        // This simulates the degradation path (auth-service doesn't know the user)

        using var creatorClient = _fixture.CreateAuthenticatedClient(_creatorId);
        await creatorClient.PostAsJsonAsync("/challenges", new
        {
            habitId = _habitId,
            recipientId = _recipientId,
            milestoneType = 0,
            targetValue = 80.0,
            periodDays = 30,
            rewardDescription = "Coffee together"
        }, CT);

        using var recipientClient = _fixture.CreateAuthenticatedClient(_recipientId);
        var response = await recipientClient.GetAsync("/challenges", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        Assert.Equal(JsonValueKind.Null, items[0].GetProperty("creatorDisplayName").ValueKind);
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
