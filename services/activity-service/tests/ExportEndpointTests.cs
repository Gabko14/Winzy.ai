using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.ActivityService.Entities;
using Xunit;

namespace Winzy.ActivityService.Tests;

[Collection("ActivityService")]
public class ExportEndpointTests : IAsyncLifetime
{
    private readonly ActivityServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public ExportEndpointTests(ActivityServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- Happy path ---

    [Fact]
    public async Task Export_WithFeedEntries_ReturnsFullData()
    {
        var now = DateTimeOffset.UtcNow;
        var entryId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.FeedEntries.Add(new FeedEntry
            {
                Id = entryId,
                ActorId = _userId,
                ActorUsername = "testuser",
                EventType = "habit.completed",
                Data = JsonDocument.Parse("""{"habitName":"Exercise"}"""),
                CreatedAt = now.AddHours(-2),
                UpdatedAt = now.AddHours(-2)
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/activity/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("activity", body.GetProperty("service").GetString());

        var entries = body.GetProperty("data").GetProperty("feedEntries");
        Assert.Equal(1, entries.GetArrayLength());

        var entry = entries[0];
        Assert.Equal(entryId, entry.GetProperty("id").GetGuid());
        Assert.Equal("habit.completed", entry.GetProperty("eventType").GetString());
    }

    [Fact]
    public async Task Export_MultipleFeedEntries_OrderedByCreatedAtDescending()
    {
        var olderId = Guid.NewGuid();
        var newerId = Guid.NewGuid();

        using (var db = _fixture.CreateDbContext())
        {
            db.FeedEntries.AddRange(
                new FeedEntry
                {
                    Id = olderId,
                    ActorId = _userId,
                    EventType = "habit.created",
                },
                new FeedEntry
                {
                    Id = newerId,
                    ActorId = _userId,
                    EventType = "challenge.completed",
                });
            await db.SaveChangesAsync(CT);

            // BaseDbContext.SetTimestamps overrides CreatedAt on save, so use raw SQL
            await db.Database.ExecuteSqlAsync(
                $"UPDATE feed_entries SET created_at = NOW() - INTERVAL '5 hours' WHERE id = {olderId}", CT);
            await db.Database.ExecuteSqlAsync(
                $"UPDATE feed_entries SET created_at = NOW() - INTERVAL '1 hour' WHERE id = {newerId}", CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/activity/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var entries = body.GetProperty("data").GetProperty("feedEntries");
        Assert.Equal(2, entries.GetArrayLength());
        Assert.Equal("challenge.completed", entries[0].GetProperty("eventType").GetString());
        Assert.Equal("habit.created", entries[1].GetProperty("eventType").GetString());
    }

    // --- Edge cases / Error conditions ---

    [Fact]
    public async Task Export_NoFeedEntries_Returns404()
    {
        var unknownUserId = Guid.NewGuid();

        using var client = _fixture.CreateAuthenticatedClient(unknownUserId);
        var response = await client.GetAsync($"/activity/internal/export/{unknownUserId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Export_DoesNotReturnOtherUsersEntries()
    {
        var otherUserId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        using (var db = _fixture.CreateDbContext())
        {
            db.FeedEntries.Add(new FeedEntry
            {
                Id = Guid.NewGuid(),
                ActorId = otherUserId,
                EventType = "habit.completed",
                CreatedAt = now,
                UpdatedAt = now
            });
            await db.SaveChangesAsync(CT);
        }

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync($"/activity/internal/export/{_userId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
