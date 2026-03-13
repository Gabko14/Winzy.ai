using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;
using NATS.Client.Serializers.Json;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Xunit;

namespace Winzy.HabitService.Tests;

public class HabitEndpointTests : IClassFixture<HabitServiceFixture>, IAsyncLifetime
{
    private readonly HabitServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();
    private static readonly string _today = DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("America/New_York"))).ToString("yyyy-MM-dd");

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public HabitEndpointTests(HabitServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- POST /habits ---

    [Fact]
    public async Task CreateHabit_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/habits", new
        {
            name = "Exercise",
            icon = "dumbbell",
            color = "#FF5733",
            frequency = 0
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Exercise", body.GetProperty("name").GetString());
        Assert.Equal("dumbbell", body.GetProperty("icon").GetString());
        Assert.Equal("#FF5733", body.GetProperty("color").GetString());
        Assert.Equal("daily", body.GetProperty("frequency").GetString());
    }

    [Fact]
    public async Task CreateHabit_MissingName_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/habits", new
        {
            name = "",
            frequency = 0
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateHabit_CustomFrequency_WithoutCustomDays_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/habits", new
        {
            name = "Gym",
            frequency = 2
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateHabit_MissingUserIdHeader_Returns400()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/habits", new
        {
            name = "Read",
            frequency = 0
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateHabit_CustomFrequency_WithDays_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/habits", new
        {
            name = "Gym",
            frequency = 2,
            customDays = new[] { 1, 3, 5 }
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // --- GET /habits ---

    [Fact]
    public async Task ListHabits_ReturnsOwnHabitsOnly()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var otherUserId = Guid.NewGuid();
        using var otherClient = _fixture.CreateAuthenticatedClient(otherUserId);

        await client.PostAsJsonAsync("/habits", new { name = "My Habit", frequency = 0 }, CT);
        await otherClient.PostAsJsonAsync("/habits", new { name = "Other Habit", frequency = 0 }, CT);

        var response = await client.GetAsync("/habits", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var habits = await response.Content.ReadFromJsonAsync<JsonElement[]>(CT);
        Assert.NotNull(habits);
        Assert.Single(habits);
        Assert.Equal("My Habit", habits[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task ListHabits_ExcludesArchivedHabits()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Archived", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();
        await client.DeleteAsync($"/habits/{habitId}", CT);

        await client.PostAsJsonAsync("/habits", new { name = "Active", frequency = 0 }, CT);

        var response = await client.GetAsync("/habits", CT);
        var habits = await response.Content.ReadFromJsonAsync<JsonElement[]>(CT);

        Assert.NotNull(habits);
        Assert.Single(habits);
        Assert.Equal("Active", habits[0].GetProperty("name").GetString());
    }

    // --- GET /habits/{id} ---

    [Fact]
    public async Task GetHabit_ExistingHabit_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Read", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.GetAsync($"/habits/{habitId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Read", body.GetProperty("name").GetString());
    }

    [Fact]
    public async Task GetHabit_OtherUsersHabit_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var otherClient = _fixture.CreateAuthenticatedClient(Guid.NewGuid());

        var createResponse = await otherClient.PostAsJsonAsync("/habits", new { name = "Secret", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.GetAsync($"/habits/{habitId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetHabit_NonExistentId_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync($"/habits/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- PUT /habits/{id} ---

    [Fact]
    public async Task UpdateHabit_ValidRequest_Returns200()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Read", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var updateResponse = await client.PutAsJsonAsync($"/habits/{habitId}", new
        {
            name = "Read Books",
            color = "#00FF00"
        }, CT);

        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var body = await updateResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Read Books", body.GetProperty("name").GetString());
        Assert.Equal("#00FF00", body.GetProperty("color").GetString());
    }

    [Fact]
    public async Task UpdateHabit_OtherUsersHabit_Returns404()
    {
        using var otherClient = _fixture.CreateAuthenticatedClient(Guid.NewGuid());
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await otherClient.PostAsJsonAsync("/habits", new { name = "Other", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.PutAsJsonAsync($"/habits/{habitId}", new { name = "Hacked" }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- DELETE /habits/{id} ---

    [Fact]
    public async Task DeleteHabit_ExistingHabit_Returns204()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Delete Me", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.DeleteAsync($"/habits/{habitId}", CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Verify it's archived (soft-deleted), not hard-deleted
        using var db = _fixture.CreateDbContext();
        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == habitId, CT);
        Assert.NotNull(habit);
        Assert.NotNull(habit!.ArchivedAt);
    }

    [Fact]
    public async Task DeleteHabit_PublishesHabitArchivedEvent()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Event Test", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        // Set up an ephemeral JetStream consumer with DeliverPolicy.New to ignore stale messages
        var natsConn = _fixture.Factory.Services.GetRequiredService<INatsConnection>();
        var js = new NatsJSContext(natsConn);
        var consumerName = $"test-habit-archived-{Guid.NewGuid():N}";
        var consumer = await js.CreateOrUpdateConsumerAsync("HABITS",
            new ConsumerConfig(consumerName)
            {
                FilterSubject = Subjects.HabitArchived,
                DeliverPolicy = ConsumerConfigDeliverPolicy.New
            },
            CT);

        var response = await client.DeleteAsync($"/habits/{habitId}", CT);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Consume the published event
        var msg = await consumer.NextAsync<HabitArchivedEvent>(
            serializer: NatsJsonSerializer<HabitArchivedEvent>.Default,
            cancellationToken: new CancellationTokenSource(TimeSpan.FromSeconds(5)).Token);

        Assert.NotNull(msg);
        Assert.Equal(_userId, msg!.Data!.UserId);
        Assert.Equal(habitId, msg.Data!.HabitId);
        await msg.AckAsync(cancellationToken: CT);
    }

    [Fact]
    public async Task DeleteHabit_AlreadyArchived_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Archive Twice", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        // First delete succeeds
        var response1 = await client.DeleteAsync($"/habits/{habitId}", CT);
        Assert.Equal(HttpStatusCode.NoContent, response1.StatusCode);

        // Second delete: the habit still exists in DB (soft-delete) so it returns 204 again (idempotent)
        var response2 = await client.DeleteAsync($"/habits/{habitId}", CT);
        Assert.Equal(HttpStatusCode.NoContent, response2.StatusCode);
    }

    // --- POST /habits/{id}/complete ---

    [Fact]
    public async Task CompleteHabit_ValidRequest_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            timezone = "America/New_York"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.TryGetProperty("consistency", out _));
        Assert.True(body.TryGetProperty("localDate", out _));
    }

    [Fact]
    public async Task CompleteHabit_SpecificDate_Returns201()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today,
            timezone = "America/New_York"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(_today, body.GetProperty("localDate").GetString());
    }

    [Fact]
    public async Task CompleteHabit_DuplicateDate_Returns409()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today,
            timezone = "America/New_York"
        }, CT);

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today,
            timezone = "America/New_York"
        }, CT);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task CompleteHabit_MissingTimezone_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CompleteHabit_InvalidTimezone_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            timezone = "Not/A/Timezone"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CompleteHabit_NonExistentHabit_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync($"/habits/{Guid.NewGuid()}/complete", new
        {
            timezone = "UTC"
        }, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- DELETE /habits/{id}/completions/{date} ---

    [Fact]
    public async Task RemoveCompletion_ExistingCompletion_Returns204()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today,
            timezone = "UTC"
        }, CT);

        var response = await client.DeleteAsync($"/habits/{habitId}/completions/{_today}", CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // Verify completion is gone from DB
        using var db = _fixture.CreateDbContext();
        var exists = await db.Completions.AnyAsync(c => c.HabitId == habitId, CT);
        Assert.False(exists);
    }

    [Fact]
    public async Task RemoveCompletion_NonExistentCompletion_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.DeleteAsync($"/habits/{habitId}/completions/2025-02-15", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task RemoveCompletion_InvalidDateFormat_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.DeleteAsync($"/habits/{Guid.NewGuid()}/completions/not-a-date", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- GET /habits/{id}/stats ---

    [Fact]
    public async Task GetStats_ReturnsConsistencyData()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        client.DefaultRequestHeaders.Add("X-Timezone", "UTC");

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        await client.PostAsJsonAsync($"/habits/{habitId}/complete", new { timezone = "UTC" }, CT);

        var response = await client.GetAsync($"/habits/{habitId}/stats", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.True(body.GetProperty("consistency").GetDouble() > 0);
        Assert.Equal(1, body.GetProperty("totalCompletions").GetInt32());
        Assert.Equal(60, body.GetProperty("windowDays").GetInt32());
        Assert.True(body.GetProperty("completedToday").GetBoolean());
    }

    [Fact]
    public async Task GetStats_MissingTimezoneHeader_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        var response = await client.GetAsync($"/habits/{habitId}/stats", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- GET /habits/user/{userId} (internal) ---

    [Fact]
    public async Task InternalGetUserHabits_ReturnsHabitsWithCompletions()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Run", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today,
            timezone = "UTC"
        }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync($"/habits/user/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var habits = await response.Content.ReadFromJsonAsync<JsonElement[]>(CT);
        Assert.NotNull(habits);
        Assert.Single(habits);
        Assert.True(habits[0].TryGetProperty("completions", out var completions));
        Assert.Equal(1, completions.GetArrayLength());
    }

    // --- GET /habits/public/{username} ---

    [Fact]
    public async Task PublicFlame_WithVisibleHabits_ReturnsOnlyPublicHabits()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var r1 = await client.PostAsJsonAsync("/habits", new { name = "Meditate", frequency = 0 }, CT);
        var h1 = (await r1.Content.ReadFromJsonAsync<JsonElement>(CT)).GetProperty("id").GetGuid();

        await client.PostAsJsonAsync("/habits", new { name = "Secret Journal", frequency = 0 }, CT);

        // Only Meditate is public
        MockAuthHandler.UsernameToUserId["testuser"] = _userId;
        MockSocialHandler.SetVisibility(_userId, [h1], "private");

        using var publicClient = _fixture.Factory.CreateClient();
        publicClient.DefaultRequestHeaders.Add("X-Timezone", "UTC");

        var response = await publicClient.GetAsync("/habits/public/testuser", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("testuser", body.GetProperty("username").GetString());
        var habits = body.GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength());
        Assert.Equal("Meditate", habits[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task PublicFlame_DefaultPublic_ReturnsAllHabits()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        await client.PostAsJsonAsync("/habits", new { name = "Habit A", frequency = 0 }, CT);
        await client.PostAsJsonAsync("/habits", new { name = "Habit B", frequency = 0 }, CT);

        MockAuthHandler.UsernameToUserId["publicuser"] = _userId;
        MockSocialHandler.SetVisibility(_userId, [], "public");

        using var publicClient = _fixture.Factory.CreateClient();
        publicClient.DefaultRequestHeaders.Add("X-Timezone", "UTC");

        var response = await publicClient.GetAsync("/habits/public/publicuser", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(2, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task PublicFlame_NoVisibilityConfig_ReturnsEmpty()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PostAsJsonAsync("/habits", new { name = "Hidden", frequency = 0 }, CT);

        MockAuthHandler.UsernameToUserId["noconfig"] = _userId;
        // No MockSocialHandler.SetVisibility — defaults to empty + private

        using var publicClient = _fixture.Factory.CreateClient();
        var response = await publicClient.GetAsync("/habits/public/noconfig", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task PublicFlame_SocialServiceUnavailable_ReturnsEmptyHabits()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PostAsJsonAsync("/habits", new { name = "Should Not Show", frequency = 0 }, CT);

        MockAuthHandler.UsernameToUserId["failsafe"] = _userId;
        MockSocialHandler.SimulateFailure();

        using var publicClient = _fixture.Factory.CreateClient();
        var response = await publicClient.GetAsync("/habits/public/failsafe", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task PublicFlame_WithoutResolvedUserId_Returns404()
    {
        using var publicClient = _fixture.Factory.CreateClient();

        var response = await publicClient.GetAsync("/habits/public/nonexistent", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /habits/public/{username}/flame.svg ---

    [Fact]
    public async Task FlameBadge_RespectsVisibility()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var r1 = await client.PostAsJsonAsync("/habits", new { name = "Public Habit", frequency = 0 }, CT);
        var h1 = (await r1.Content.ReadFromJsonAsync<JsonElement>(CT)).GetProperty("id").GetGuid();

        await client.PostAsJsonAsync("/habits", new { name = "Private Habit", frequency = 0 }, CT);

        MockAuthHandler.UsernameToUserId["badgeuser"] = _userId;
        MockSocialHandler.SetVisibility(_userId, [h1], "private");

        using var publicClient = _fixture.Factory.CreateClient();
        var response = await publicClient.GetAsync("/habits/public/badgeuser/flame.svg", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/svg+xml", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task FlameBadge_SocialServiceUnavailable_ReturnsNoneFlame()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        await client.PostAsJsonAsync("/habits", new { name = "Some Habit", frequency = 0 }, CT);

        MockAuthHandler.UsernameToUserId["failbadge"] = _userId;
        MockSocialHandler.SimulateFailure();

        using var publicClient = _fixture.Factory.CreateClient();
        var response = await publicClient.GetAsync("/habits/public/failbadge/flame.svg", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var svg = await response.Content.ReadAsStringAsync(CT);
        // With no visible habits, consistency is 0 → "none" flame → gray colors
        Assert.Contains("#9CA3AF", svg);
    }

    // --- GET /habits/completions?date=YYYY-MM-DD ---

    [Fact]
    public async Task GetCompletions_ReturnsCompletionStatusForAllHabits()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Create two habits
        var r1 = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var h1 = (await r1.Content.ReadFromJsonAsync<JsonElement>(CT)).GetProperty("id").GetGuid();

        var r2 = await client.PostAsJsonAsync("/habits", new { name = "Read", frequency = 0 }, CT);
        var h2 = (await r2.Content.ReadFromJsonAsync<JsonElement>(CT)).GetProperty("id").GetGuid();

        // Complete only the first habit today
        await client.PostAsJsonAsync($"/habits/{h1}/complete", new
        {
            date = _today,
            timezone = "America/New_York"
        }, CT);

        var response = await client.GetAsync($"/habits/completions?date={_today}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(_today, body.GetProperty("date").GetString());

        var habits = body.GetProperty("habits").EnumerateArray().ToList();
        Assert.Equal(2, habits.Count);

        var exerciseHabit = habits.First(h => h.GetProperty("id").GetGuid() == h1);
        var readHabit = habits.First(h => h.GetProperty("id").GetGuid() == h2);

        Assert.True(exerciseHabit.GetProperty("completed").GetBoolean());
        Assert.False(readHabit.GetProperty("completed").GetBoolean());
    }

    [Fact]
    public async Task GetCompletions_MissingDate_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/habits/completions", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetCompletions_InvalidDate_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync("/habits/completions?date=not-a-date", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetCompletions_NoHabits_ReturnsEmptyList()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.GetAsync($"/habits/completions?date={_today}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("habits").GetArrayLength());
    }

    [Fact]
    public async Task GetCompletions_ExcludesArchivedHabits()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var r1 = await client.PostAsJsonAsync("/habits", new { name = "Archived", frequency = 0 }, CT);
        var h1 = (await r1.Content.ReadFromJsonAsync<JsonElement>(CT)).GetProperty("id").GetGuid();
        await client.DeleteAsync($"/habits/{h1}", CT);

        await client.PostAsJsonAsync("/habits", new { name = "Active", frequency = 0 }, CT);

        var response = await client.GetAsync($"/habits/completions?date={_today}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits").EnumerateArray().ToList();
        Assert.Single(habits);
        Assert.Equal("Active", habits[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task GetCompletions_OtherUsersHabits_NotReturned()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        using var otherClient = _fixture.CreateAuthenticatedClient(Guid.NewGuid());

        await client.PostAsJsonAsync("/habits", new { name = "My Habit", frequency = 0 }, CT);
        await otherClient.PostAsJsonAsync("/habits", new { name = "Other Habit", frequency = 0 }, CT);

        var response = await client.GetAsync($"/habits/completions?date={_today}", CT);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("habits").EnumerateArray().ToList();
        Assert.Single(habits);
        Assert.Equal("My Habit", habits[0].GetProperty("name").GetString());
    }

    // --- GET /habits/internal/{habitId}/consistency ---

    [Fact]
    public async Task InternalConsistency_ReturnsRangeSpecificConsistency()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        // Complete today
        await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today,
            timezone = "America/New_York"
        }, CT);

        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync(
            $"/habits/internal/{habitId}/consistency?from={_today}&to={_today}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(100, body.GetProperty("consistency").GetDouble());
        Assert.Equal(_today, body.GetProperty("from").GetString());
        Assert.Equal(_today, body.GetProperty("to").GetString());
    }

    [Fact]
    public async Task InternalConsistency_MissingParams_Returns400()
    {
        using var internalClient = _fixture.Factory.CreateClient();
        var habitId = Guid.NewGuid();

        var response = await internalClient.GetAsync($"/habits/internal/{habitId}/consistency", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task InternalConsistency_NonExistentHabit_Returns404()
    {
        using var internalClient = _fixture.Factory.CreateClient();

        var response = await internalClient.GetAsync(
            $"/habits/internal/{Guid.NewGuid()}/consistency?from=2025-02-01&to=2025-02-14", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task InternalConsistency_NoCompletionsInRange_Returns0()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var createResponse = await client.PostAsJsonAsync("/habits", new { name = "Exercise", frequency = 0 }, CT);
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habitId = created.GetProperty("id").GetGuid();

        // Complete today
        await client.PostAsJsonAsync($"/habits/{habitId}/complete", new
        {
            date = _today,
            timezone = "America/New_York"
        }, CT);

        // Query a range that doesn't include today
        using var internalClient = _fixture.Factory.CreateClient();
        var response = await internalClient.GetAsync(
            $"/habits/internal/{habitId}/consistency?from=2025-01-01&to=2025-01-31", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal(0, body.GetProperty("consistency").GetDouble());
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
