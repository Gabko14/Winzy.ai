using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.HabitService.Entities;
using Xunit;

namespace Winzy.HabitService.Tests;

public class PromiseEndpointTests : IClassFixture<HabitServiceFixture>, IAsyncLifetime
{
    private readonly HabitServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public PromiseEndpointTests(HabitServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- Helper: create a habit and return its ID ---
    private async Task<Guid> CreateHabitAsync(HttpClient client, string name = "Reading")
    {
        var response = await client.PostAsJsonAsync("/habits", new { name, frequency = 0 }, CT);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        return body.GetProperty("id").GetGuid();
    }

    private static string FutureDate(int daysFromNow = 30)
        => DateOnly.FromDateTime(DateTime.UtcNow).AddDays(daysFromNow).ToString("yyyy-MM-dd");

    // ===== Happy Path: Create Promise =====

    [Fact]
    public async Task CreatePromise_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(70.0, body.GetProperty("targetConsistency").GetDouble());
        Assert.Equal("active", body.GetProperty("status").GetString());
        Assert.True(body.TryGetProperty("statement", out var statement));
        Assert.Contains("70%", statement.GetString()!);
        Assert.False(body.GetProperty("isPublicOnFlame").GetBoolean());
    }

    [Fact]
    public async Task CreatePromise_WithPrivateNote_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 80.0,
            endDate = FutureDate(),
            privateNote = "I really want to keep this up"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("I really want to keep this up", body.GetProperty("privateNote").GetString());
    }

    // ===== Happy Path: Get Promise =====

    [Fact]
    public async Task GetPromise_ActivePromise_ReturnsWithOnTrackStatus()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 50.0,
            endDate = FutureDate()
        }, CT);

        var response = await client.GetAsync($"/habits/{habitId}/promise", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.NotEqual(JsonValueKind.Null, body.GetProperty("active").ValueKind);
        var active = body.GetProperty("active");
        Assert.Equal("active", active.GetProperty("status").GetString());
        Assert.True(active.TryGetProperty("onTrack", out _));
        Assert.True(active.TryGetProperty("currentConsistency", out _));
    }

    [Fact]
    public async Task GetPromise_NoActivePromise_ReturnsNullActive()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.GetAsync($"/habits/{habitId}/promise", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("active").ValueKind);
    }

    [Fact]
    public async Task GetPromise_WithHistory_ReturnsResolvedPromises()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        // Create and cancel a promise
        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);
        await client.DeleteAsync($"/habits/{habitId}/promise", CT);

        // Create a new active promise
        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 60.0,
            endDate = FutureDate(60)
        }, CT);

        var response = await client.GetAsync($"/habits/{habitId}/promise?history=true", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.NotEqual(JsonValueKind.Null, body.GetProperty("active").ValueKind);
        Assert.Equal(60.0, body.GetProperty("active").GetProperty("targetConsistency").GetDouble());
        var history = body.GetProperty("history");
        Assert.Equal(1, history.GetArrayLength());
        Assert.Equal("cancelled", history[0].GetProperty("status").GetString());
    }

    // ===== Happy Path: Cancel Promise =====

    [Fact]
    public async Task CancelPromise_ActivePromise_Returns204()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        var response = await client.DeleteAsync($"/habits/{habitId}/promise", CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Verify it's cancelled in DB
        using var db = _fixture.CreateDbContext();
        var promise = await db.Promises.FirstOrDefaultAsync(p => p.HabitId == habitId, CT);
        Assert.NotNull(promise);
        Assert.Equal(PromiseStatus.Cancelled, promise!.Status);
        Assert.NotNull(promise.ResolvedAt);
    }

    [Fact]
    public async Task CancelPromise_ThenCreateNew_Succeeds()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        // Create and cancel
        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);
        await client.DeleteAsync($"/habits/{habitId}/promise", CT);

        // Create a new one
        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 50.0,
            endDate = FutureDate(60)
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // ===== Edge Cases =====

    [Fact]
    public async Task CreatePromise_DuplicateActive_Returns409()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 80.0,
            endDate = FutureDate(60)
        }, CT);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("active promise", body.GetProperty("error").GetString()!);
    }

    [Fact]
    public async Task CreatePromise_ArchivedHabit_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);
        await client.DeleteAsync($"/habits/{habitId}", CT); // Archive the habit

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetPromise_ExpiredPromise_AutoResolves()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        // Create promise with a past end date (by directly inserting into DB)
        using (var db = _fixture.CreateDbContext())
        {
            var promise = new Promise
            {
                UserId = _userId,
                HabitId = habitId,
                TargetConsistency = 70.0,
                EndDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1), // Yesterday
                Status = PromiseStatus.Active
            };
            db.Promises.Add(promise);
            await db.SaveChangesAsync(CT);
        }

        var response = await client.GetAsync($"/habits/{habitId}/promise", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        // Active should be null since the expired promise was auto-resolved
        Assert.Equal(JsonValueKind.Null, body.GetProperty("active").ValueKind);
    }

    [Fact]
    public async Task GetPromise_DifferentUser_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        // Different user tries to access
        using var otherClient = _fixture.CreateAuthenticatedClient(Guid.NewGuid());
        var response = await otherClient.GetAsync($"/habits/{habitId}/promise", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CancelPromise_NoActivePromise_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.DeleteAsync($"/habits/{habitId}/promise", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CancelPromise_AlreadyCancelled_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);
        await client.DeleteAsync($"/habits/{habitId}/promise", CT);

        // Second cancel should 404
        var response = await client.DeleteAsync($"/habits/{habitId}/promise", CT);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_StatementGeneration_IncludesTargetAndDate()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var endDate = FutureDate(30);
        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 75.0,
            endDate
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var statement = body.GetProperty("statement").GetString()!;
        Assert.Contains("75%", statement);
        // Statement should include the month name from the end date
        var parsedDate = DateOnly.Parse(endDate);
        Assert.Contains(parsedDate.ToString("MMMM"), statement);
    }

    // ===== Error Conditions: Validation =====

    [Fact]
    public async Task CreatePromise_TargetTooLow_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 0.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("between 1 and 100", body.GetProperty("error").GetString()!);
    }

    [Fact]
    public async Task CreatePromise_TargetTooHigh_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 101.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_PastEndDate_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1).ToString("yyyy-MM-dd");
        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = yesterday
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Contains("future", body.GetProperty("error").GetString()!);
    }

    [Fact]
    public async Task CreatePromise_TodayEndDate_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = today
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_InvalidDateFormat_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = "not-a-date"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_PrivateNoteTooLong_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate(),
            privateNote = new string('a', 513)
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_NonExistentHabit_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync($"/habits/{Guid.NewGuid()}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_OtherUsersHabit_Returns404()
    {
        using var otherClient = _fixture.CreateAuthenticatedClient(Guid.NewGuid());
        var habitId = await CreateHabitAsync(otherClient);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_MissingUserIdHeader_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync($"/habits/{Guid.NewGuid()}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_MalformedJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var content = new StringContent("{invalid json", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PostAsync($"/habits/{habitId}/promise", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task CreatePromise_EmptyBody_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var content = new StringContent("", System.Text.Encoding.UTF8);
        content.Headers.ContentType = null;
        var response = await client.PostAsync($"/habits/{habitId}/promise", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ===== Promise Lifecycle: Kept & EndedBelow =====

    [Fact]
    public async Task GetPromise_ExpiredWithHighConsistency_ResolvesAsKept()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        // Backdate the habit's CreatedAt so past completions fall within the consistency window
        using (var db = _fixture.CreateDbContext())
        {
            var habit = await db.Habits.FirstAsync(h => h.Id == habitId, CT);
            habit.CreatedAt = DateTimeOffset.UtcNow.AddDays(-60);
            await db.SaveChangesAsync(CT);
        }

        // Complete habit for many days to build consistency
        for (var i = 1; i <= 30; i++)
        {
            var date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-i).ToString("yyyy-MM-dd");
            await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
            {
                date,
                timezone = "UTC"
            }, CT);
        }

        // Insert promise with yesterday as end date and a low target that the 30-day streak easily meets
        using (var db = _fixture.CreateDbContext())
        {
            var promise = new Promise
            {
                UserId = _userId,
                HabitId = habitId,
                TargetConsistency = 10.0, // Very low target — easily met with 30/59 days
                EndDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1),
                Status = PromiseStatus.Active
            };
            db.Promises.Add(promise);
            await db.SaveChangesAsync(CT);
        }

        client.DefaultRequestHeaders.Add("X-Timezone", "UTC");
        var response = await client.GetAsync($"/habits/{habitId}/promise?history=true", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        // Active should be null (resolved)
        Assert.Equal(JsonValueKind.Null, body.GetProperty("active").ValueKind);
        // History should contain the resolved promise as "kept"
        var history = body.GetProperty("history");
        Assert.Equal(1, history.GetArrayLength());
        Assert.Equal("kept", history[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task GetPromise_ExpiredWithLowConsistency_ResolvesAsEndedBelow()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        // No completions — consistency will be 0

        // Insert promise with yesterday as end date and high target
        using (var db = _fixture.CreateDbContext())
        {
            var promise = new Promise
            {
                UserId = _userId,
                HabitId = habitId,
                TargetConsistency = 90.0, // Very high target — not met with 0 completions
                EndDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1),
                Status = PromiseStatus.Active
            };
            db.Promises.Add(promise);
            await db.SaveChangesAsync(CT);
        }

        client.DefaultRequestHeaders.Add("X-Timezone", "UTC");
        var response = await client.GetAsync($"/habits/{habitId}/promise?history=true", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("active").ValueKind);
        var history = body.GetProperty("history");
        Assert.Equal(1, history.GetArrayLength());
        Assert.Equal("endedbelow", history[0].GetProperty("status").GetString());
    }

    // ===== Boundary: Target consistency at exact limits =====

    [Fact]
    public async Task CreatePromise_Target1_Accepted()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 1.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_Target100_Accepted()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 100.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // ===== Promise on different habits (same user) =====

    [Fact]
    public async Task CreatePromise_DifferentHabits_BothSucceed()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId1 = await CreateHabitAsync(client, "Reading");
        var habitId2 = await CreateHabitAsync(client, "Exercise");

        var r1 = await client.PostAsJsonAsync($"/habits/{habitId1}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        var r2 = await client.PostAsJsonAsync($"/habits/{habitId2}/promise", new
        {
            targetConsistency = 60.0,
            endDate = FutureDate()
        }, CT);

        Assert.Equal(HttpStatusCode.Created, r1.StatusCode);
        Assert.Equal(HttpStatusCode.Created, r2.StatusCode);
    }

    // ===== CancelPromise on other user's habit =====

    [Fact]
    public async Task CancelPromise_OtherUsersHabit_Returns404()
    {
        using var ownerClient = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(ownerClient);

        await ownerClient.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        // Different user tries to cancel
        using var otherClient = _fixture.CreateAuthenticatedClient(Guid.NewGuid());
        var response = await otherClient.DeleteAsync($"/habits/{habitId}/promise", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ===== Promise Visibility =====

    [Fact]
    public async Task ToggleVisibility_SetPublic_ReturnsOk()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        var response = await client.PatchAsJsonAsync($"/habits/{habitId}/promise/visibility", new
        {
            isPublicOnFlame = true
        }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("isPublicOnFlame").GetBoolean());
    }

    [Fact]
    public async Task ToggleVisibility_SetPrivate_ReturnsOk()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate(),
            isPublicOnFlame = true
        }, CT);

        var response = await client.PatchAsJsonAsync($"/habits/{habitId}/promise/visibility", new
        {
            isPublicOnFlame = false
        }, CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.False(body.GetProperty("isPublicOnFlame").GetBoolean());
    }

    [Fact]
    public async Task ToggleVisibility_NoActivePromise_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PatchAsJsonAsync($"/habits/{habitId}/promise/visibility", new
        {
            isPublicOnFlame = true
        }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ToggleVisibility_OtherUsersPromise_Returns404()
    {
        using var ownerClient = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(ownerClient);

        await ownerClient.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        using var otherClient = _fixture.CreateAuthenticatedClient(Guid.NewGuid());
        var response = await otherClient.PatchAsJsonAsync($"/habits/{habitId}/promise/visibility", new
        {
            isPublicOnFlame = true
        }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreatePromise_WithIsPublicOnFlame_PersistsValue()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate(),
            isPublicOnFlame = true
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("isPublicOnFlame").GetBoolean());
    }

    [Fact]
    public async Task GetPromise_IncludesIsPublicOnFlame()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate(),
            isPublicOnFlame = true
        }, CT);

        var response = await client.GetAsync($"/habits/{habitId}/promise", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var active = body.GetProperty("active");
        Assert.True(active.GetProperty("isPublicOnFlame").GetBoolean());
    }

    [Fact]
    public async Task PublicFlame_IncludesPromiseWhenPublic()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        // Set up mock auth + social for public flame
        MockAuthHandler.UsernameToUserId["testpublic"] = _userId;
        MockSocialHandler.SetVisibility(_userId, [habitId], "public");

        // Create a promise with public visibility
        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate(),
            isPublicOnFlame = true
        }, CT);

        var response = await client.GetAsync("/habits/public/testpublic", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength());
        var habit = habits[0];
        Assert.True(habit.TryGetProperty("promise", out var promise));
        Assert.NotEqual(JsonValueKind.Null, promise.ValueKind);
        Assert.Contains("70%", promise.GetProperty("statement").GetString()!);
        // PrivateNote must NOT appear on public surface
        Assert.False(promise.TryGetProperty("privateNote", out _));
    }

    [Fact]
    public async Task PublicFlame_ExcludesPromiseWhenNotPublic()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        MockAuthHandler.UsernameToUserId["testprivate"] = _userId;
        MockSocialHandler.SetVisibility(_userId, [habitId], "public");

        // Create a promise WITHOUT public visibility (default)
        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        var response = await client.GetAsync("/habits/public/testprivate", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength());
        var habit = habits[0];
        Assert.True(habit.TryGetProperty("promise", out var promise));
        Assert.Equal(JsonValueKind.Null, promise.ValueKind);
    }

    [Fact]
    public async Task ToggleVisibility_MissingBody_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        var content = new StringContent("", System.Text.Encoding.UTF8);
        content.Headers.ContentType = null;
        var response = await client.PatchAsync($"/habits/{habitId}/promise/visibility", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ToggleVisibility_MalformedJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var habitId = await CreateHabitAsync(client);

        await client.PostAsJsonAsync($"/habits/{habitId}/promise", new
        {
            targetConsistency = 70.0,
            endDate = FutureDate()
        }, CT);

        var content = new StringContent("{invalid", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PatchAsync($"/habits/{habitId}/promise/visibility", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ToggleVisibility_MissingUserId_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PatchAsJsonAsync($"/habits/{Guid.NewGuid()}/promise/visibility", new
        {
            isPublicOnFlame = true
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
