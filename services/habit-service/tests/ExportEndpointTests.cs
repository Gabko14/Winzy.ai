using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.HabitService.Entities;
using Xunit;

namespace Winzy.HabitService.Tests;

public class ExportEndpointTests : IClassFixture<HabitServiceFixture>, IAsyncLifetime
{
    private readonly HabitServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public ExportEndpointTests(HabitServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- Happy path ---

    [Fact]
    public async Task Export_WithHabitsAndCompletions_ReturnsFullData()
    {
        var habitId = Guid.NewGuid();
        var completionId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.Habits.Add(new Habit
            {
                Id = habitId,
                UserId = _userId,
                Name = "Exercise",
                Icon = "dumbbell",
                Color = "#FF0000",
                Frequency = FrequencyType.Daily,
                CreatedAt = now.AddDays(-10),
                UpdatedAt = now.AddDays(-10),
                Completions =
                [
                    new Completion
                    {
                        Id = completionId,
                        HabitId = habitId,
                        UserId = _userId,
                        CompletedAt = now.AddDays(-1),
                        LocalDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
                        Note = "Morning run",
                        CreatedAt = now.AddDays(-1),
                        UpdatedAt = now.AddDays(-1)
                    }
                ]
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/habits/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("habit", body.GetProperty("service").GetString());

        var habits = body.GetProperty("data").GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength());

        var habit = habits[0];
        Assert.Equal(habitId, habit.GetProperty("habitId").GetGuid());
        Assert.Equal("Exercise", habit.GetProperty("name").GetString());
        Assert.Equal("dumbbell", habit.GetProperty("icon").GetString());
        Assert.Equal("#FF0000", habit.GetProperty("color").GetString());
        Assert.Equal("Daily", habit.GetProperty("frequency").GetString());

        var completions = habit.GetProperty("completions");
        Assert.Equal(1, completions.GetArrayLength());
        Assert.Equal(completionId, completions[0].GetProperty("completionId").GetGuid());
        Assert.Equal("Morning run", completions[0].GetProperty("note").GetString());
    }

    [Fact]
    public async Task Export_MultipleHabits_ReturnsOrderedByCreatedAt()
    {
        var habit1Id = Guid.NewGuid();
        var habit2Id = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.Habits.AddRange(
                new Habit
                {
                    Id = habit1Id,
                    UserId = _userId,
                    Name = "Older Habit",
                    Frequency = FrequencyType.Daily,
                },
                new Habit
                {
                    Id = habit2Id,
                    UserId = _userId,
                    Name = "Newer Habit",
                    Frequency = FrequencyType.Weekly,
                });
            await db.SaveChangesAsync(CT);

            // BaseDbContext.SetTimestamps overrides CreatedAt on save, so use raw SQL
            await db.Database.ExecuteSqlAsync(
                $"UPDATE habits SET created_at = NOW() - INTERVAL '20 days' WHERE id = {habit1Id}", CT);
            await db.Database.ExecuteSqlAsync(
                $"UPDATE habits SET created_at = NOW() - INTERVAL '5 days' WHERE id = {habit2Id}", CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/habits/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("data").GetProperty("habits");
        Assert.Equal(2, habits.GetArrayLength());
        Assert.Equal("Older Habit", habits[0].GetProperty("name").GetString());
        Assert.Equal("Newer Habit", habits[1].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Export_IncludesArchivedHabits()
    {
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.Habits.Add(new Habit
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                Name = "Archived Habit",
                Frequency = FrequencyType.Daily,
                ArchivedAt = now.AddDays(-2),
                CreatedAt = now.AddDays(-30),
                UpdatedAt = now.AddDays(-2)
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/habits/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var habits = body.GetProperty("data").GetProperty("habits");
        Assert.Equal(1, habits.GetArrayLength());
        Assert.NotEqual(JsonValueKind.Null, habits[0].GetProperty("archivedAt").ValueKind);
    }

    // --- Edge cases / Error conditions ---

    [Fact]
    public async Task Export_NoHabits_Returns404()
    {
        var unknownUserId = Guid.NewGuid();

        using var client = _fixture.CreateAuthenticatedClient(unknownUserId);
        var response = await client.GetAsync($"/habits/internal/export/{unknownUserId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Export_DoesNotReturnOtherUsersData()
    {
        var otherUserId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.Habits.Add(new Habit
            {
                Id = Guid.NewGuid(),
                UserId = otherUserId,
                Name = "Other User Habit",
                Frequency = FrequencyType.Daily,
                CreatedAt = now,
                UpdatedAt = now
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/habits/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
