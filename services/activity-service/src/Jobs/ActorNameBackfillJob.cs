using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Winzy.ActivityService.Data;

namespace Winzy.ActivityService.Jobs;

public sealed class ActorNameBackfillJob(
    IServiceScopeFactory scopeFactory,
    IHttpClientFactory httpClientFactory,
    ILogger<ActorNameBackfillJob> logger) : BackgroundService
{
    private static readonly TimeSpan _interval = TimeSpan.FromSeconds(60);
    private const int BatchSize = 100;

    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the app finish starting before running the first pass
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await BackfillAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Actor name backfill pass failed");
            }

            await Task.Delay(_interval, stoppingToken);
        }
    }

    internal async Task BackfillAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var missingNameEntries = await db.FeedEntries
            .Where(e => e.ActorUsername == null)
            .Select(e => e.ActorId)
            .Distinct()
            .Take(BatchSize)
            .ToListAsync(ct);

        if (missingNameEntries.Count == 0)
            return;

        logger.LogInformation("Backfilling actor names for {Count} distinct actor(s)", missingNameEntries.Count);

        var authClient = httpClientFactory.CreateClient("AuthService");

        List<ProfileResponse>? profiles;
        try
        {
            using var response = await authClient.PostAsJsonAsync(
                "/auth/internal/profiles", new { userIds = missingNameEntries }, ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Auth Service returned {StatusCode} during backfill", response.StatusCode);
                return;
            }

            profiles = await response.Content.ReadFromJsonAsync<List<ProfileResponse>>(_jsonOptions, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to fetch profiles from Auth Service during backfill");
            return;
        }

        if (profiles is null || profiles.Count == 0)
            return;

        var profileMap = profiles
            .GroupBy(p => p.UserId)
            .ToDictionary(g => g.Key, g => g.First());

        var resolvedActorIds = profileMap.Keys.ToList();
        var entriesToUpdate = await db.FeedEntries
            .Where(e => resolvedActorIds.Contains(e.ActorId) && e.ActorUsername == null)
            .ToListAsync(ct);

        foreach (var entry in entriesToUpdate)
        {
            if (profileMap.TryGetValue(entry.ActorId, out var p))
            {
                entry.ActorUsername = p.Username;
                entry.ActorDisplayName = p.DisplayName;
            }
        }

        if (entriesToUpdate.Count > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Backfilled actor names for {Count} feed entries", entriesToUpdate.Count);
        }
    }

    internal record ProfileResponse(Guid UserId, string Username, string? DisplayName);
}
