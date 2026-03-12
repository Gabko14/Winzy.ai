using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Winzy.ActivityService.Data;
using Winzy.ActivityService.Subscribers;
using Winzy.Common.Health;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<ActivityDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<UserRegisteredSubscriber>();
builder.Services.AddHostedService<HabitCreatedSubscriber>();
builder.Services.AddHostedService<HabitCompletedSubscriber>();
builder.Services.AddHostedService<FriendRequestAcceptedSubscriber>();
builder.Services.AddHostedService<ChallengeCreatedSubscriber>();
builder.Services.AddHostedService<ChallengeCompletedSubscriber>();
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<ActivityDbContext>()
    .AddNatsHealthCheck();

builder.Services.AddHttpClient("SocialService", client =>
{
    var socialUrl = builder.Configuration["Services:SocialServiceUrl"] ?? "http://social-service:5003";
    client.BaseAddress = new Uri(socialUrl);
    client.Timeout = TimeSpan.FromSeconds(5);
});

var app = builder.Build();

app.UseObservability();
app.MapOpenApi();
app.MapServiceHealthChecks();

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
};

// --- GET /activity/feed ---
// Returns the authenticated user's activity feed (entries from friends only).
// Cursor-based pagination via ?cursor=<created_at_iso>&limit=<n>

app.MapGet("/activity/feed", async (HttpContext ctx, ActivityDbContext db, IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    // Parse pagination parameters
    var limitStr = ctx.Request.Query["limit"].FirstOrDefault();
    var cursorStr = ctx.Request.Query["cursor"].FirstOrDefault();

    var limit = 20;
    if (limitStr is not null)
    {
        if (!int.TryParse(limitStr, out limit) || limit < 1)
            return Results.BadRequest(new { error = "limit must be a positive integer" });
        limit = Math.Min(limit, 100);
    }

    DateTimeOffset? cursor = null;
    if (cursorStr is not null)
    {
        if (!DateTimeOffset.TryParse(cursorStr, out var parsedCursor))
            return Results.BadRequest(new { error = "Invalid cursor format" });
        cursor = parsedCursor;
    }

    // Get friend list from Social Service
    var socialClient = httpClientFactory.CreateClient("SocialService");
    List<Guid> friendIds;
    try
    {
        using var response = await socialClient.GetAsync($"/social/internal/friends/{userId}");

        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Social Service returned {StatusCode} for friends list of UserId={UserId}",
                response.StatusCode, userId);
            friendIds = [];
        }
        else
        {
            var friendsResponse = await response.Content.ReadFromJsonAsync<FriendsListResponse>(jsonOptions);
            friendIds = friendsResponse?.FriendIds ?? [];
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
        logger.LogWarning(ex, "Failed to fetch friends list from Social Service for UserId={UserId}", userId);
        friendIds = [];
    }

    // Include the user's own entries plus entries from friends
    var actorIds = new List<Guid>(friendIds) { userId };

    // Fetch visible habit IDs per friend for visibility filtering
    // (user's own habit events are always visible)
    var visibleHabitsPerFriend = new Dictionary<Guid, HashSet<Guid>?>();
    var habitEventTypes = new HashSet<string> { "habit.created", "habit.completed" };

    foreach (var friendId in friendIds)
    {
        try
        {
            using var visResponse = await socialClient.GetAsync(
                $"/social/internal/visible-habits/{friendId}?viewer={userId}");

            if (visResponse.IsSuccessStatusCode)
            {
                var visData = await visResponse.Content.ReadFromJsonAsync<VisibleHabitsResponse>(jsonOptions);
                visibleHabitsPerFriend[friendId] = visData?.HabitIds?.ToHashSet() ?? [];
            }
            else
            {
                // If visibility check fails, exclude friend's habit events (safe default)
                visibleHabitsPerFriend[friendId] = [];
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(ex, "Failed to fetch visible habits for FriendId={FriendId}", friendId);
            visibleHabitsPerFriend[friendId] = [];
        }
    }

    // Over-fetch to compensate for visibility filtering
    var fetchLimit = (limit + 1) * 2;

    var query = db.FeedEntries
        .Where(e => actorIds.Contains(e.ActorId));

    if (cursor.HasValue)
        query = query.Where(e => e.CreatedAt < cursor.Value);

    var rawEntries = await query
        .OrderByDescending(e => e.CreatedAt)
        .Take(fetchLimit)
        .Select(e => new
        {
            e.Id,
            actorId = e.ActorId,
            eventType = e.EventType,
            data = e.Data,
            createdAt = e.CreatedAt
        })
        .ToListAsync();

    // Apply visibility filtering: hide friend's habit events for non-visible habits
    var filtered = rawEntries.Where(e =>
    {
        // User's own entries are always visible
        if (e.actorId == userId)
            return true;

        // Non-habit events are always visible (friend accepted, challenge events, etc.)
        if (!habitEventTypes.Contains(e.eventType))
            return true;

        // Check if the habit is visible to the requesting user
        if (!visibleHabitsPerFriend.TryGetValue(e.actorId, out var visibleHabitIds) || visibleHabitIds is null)
            return false;

        // Extract habitId from the JSONB data
        if (e.data is not null && e.data.RootElement.TryGetProperty("habitId", out var habitIdProp))
        {
            if (Guid.TryParse(habitIdProp.GetString(), out var habitId))
                return visibleHabitIds.Contains(habitId);
        }

        return false;
    }).ToList();

    var hasMore = filtered.Count > limit;
    var page = hasMore ? filtered[..limit] : filtered;
    var nextCursor = hasMore ? page[^1].createdAt.ToString("O") : null;

    return Results.Ok(new
    {
        items = page,
        nextCursor,
        hasMore
    });
});

app.Run();

// --- Helpers ---

static bool TryGetUserId(HttpContext ctx, out Guid userId)
{
    userId = Guid.Empty;
    var header = ctx.Request.Headers["X-User-Id"].FirstOrDefault();
    return header is not null && Guid.TryParse(header, out userId);
}

// --- DTOs ---

internal record FriendsListResponse(List<Guid> FriendIds);
internal record VisibleHabitsResponse(List<Guid> HabitIds, string DefaultVisibility);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
