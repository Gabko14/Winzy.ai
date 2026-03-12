using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Winzy.Common.Health;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.SocialService.Data;
using Winzy.SocialService.Entities;
using Winzy.SocialService.Subscribers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<SocialDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddHostedService<HabitCreatedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<SocialDbContext>()
    .AddNatsHealthCheck();

builder.Services.AddHttpClient("HabitService", client =>
{
    var habitUrl = builder.Configuration["Services:HabitServiceUrl"] ?? "http://habit-service:5002";
    client.BaseAddress = new Uri(habitUrl);
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

// --- POST /social/friends/request ---

app.MapPost("/social/friends/request", async (HttpContext ctx, SocialDbContext db, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var request = await ctx.Request.ReadFromJsonAsync<FriendRequestDto>(jsonOptions);
    if (request is null || request.FriendId == Guid.Empty)
        return Results.BadRequest(new { error = "FriendId is required" });

    if (request.FriendId == userId)
        return Results.BadRequest(new { error = "Cannot send friend request to yourself" });

    // Check for existing relationship in either direction
    var existing = await db.Friendships
        .FirstOrDefaultAsync(f =>
            (f.UserId == userId && f.FriendId == request.FriendId) ||
            (f.UserId == request.FriendId && f.FriendId == userId));

    if (existing is not null)
    {
        if (existing.Status == FriendshipStatus.Accepted)
            return Results.Conflict(new { error = "Already friends" });
        return Results.Conflict(new { error = "Friend request already exists" });
    }

    var friendship = new Friendship
    {
        UserId = userId,
        FriendId = request.FriendId,
        Status = FriendshipStatus.Pending
    };

    db.Friendships.Add(friendship);
    await db.SaveChangesAsync();

    try
    {
        await nats.PublishAsync(Subjects.FriendRequestSent,
            new FriendRequestSentEvent(userId, request.FriendId));
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Failed to publish friend.request.sent event from {UserId} to {FriendId}",
            userId, request.FriendId);
    }

    logger.LogInformation("Friend request sent from UserId={UserId} to FriendId={FriendId}, FriendshipId={FriendshipId}",
        userId, request.FriendId, friendship.Id);

    return Results.Created($"/social/friends/request/{friendship.Id}", new
    {
        id = friendship.Id,
        userId = friendship.UserId,
        friendId = friendship.FriendId,
        status = "pending",
        createdAt = friendship.CreatedAt
    });
});

// --- PUT /social/friends/request/{id}/accept ---

app.MapPut("/social/friends/request/{id:guid}/accept", async (Guid id, HttpContext ctx, SocialDbContext db, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var friendship = await db.Friendships
        .FirstOrDefaultAsync(f => f.Id == id && f.FriendId == userId && f.Status == FriendshipStatus.Pending);

    if (friendship is null)
        return Results.NotFound();

    friendship.Status = FriendshipStatus.Accepted;

    // Create the reverse relationship for bidirectional friendship
    var reverse = new Friendship
    {
        UserId = userId,
        FriendId = friendship.UserId,
        Status = FriendshipStatus.Accepted
    };

    db.Friendships.Add(reverse);
    await db.SaveChangesAsync();

    try
    {
        await nats.PublishAsync(Subjects.FriendRequestAccepted,
            new FriendRequestAcceptedEvent(friendship.UserId, userId));
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Failed to publish friend.request.accepted event for {UserId1} and {UserId2}",
            friendship.UserId, userId);
    }

    logger.LogInformation("Friend request {FriendshipId} accepted by UserId={UserId}, now friends with UserId={FriendId}",
        id, userId, friendship.UserId);

    return Results.Ok(new
    {
        id = friendship.Id,
        userId = friendship.UserId,
        friendId = friendship.FriendId,
        status = "accepted",
        createdAt = friendship.CreatedAt
    });
});

// --- PUT /social/friends/request/{id}/decline ---

app.MapPut("/social/friends/request/{id:guid}/decline", async (Guid id, HttpContext ctx, SocialDbContext db, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var friendship = await db.Friendships
        .FirstOrDefaultAsync(f => f.Id == id && f.FriendId == userId && f.Status == FriendshipStatus.Pending);

    if (friendship is null)
        return Results.NotFound();

    db.Friendships.Remove(friendship);
    await db.SaveChangesAsync();

    logger.LogInformation("Friend request {FriendshipId} declined by UserId={UserId}", id, userId);

    return Results.NoContent();
});

// --- DELETE /social/friends/{id} ---

app.MapDelete("/social/friends/{friendId:guid}", async (Guid friendId, HttpContext ctx, SocialDbContext db, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    // Find and remove both directions of the friendship
    var friendships = await db.Friendships
        .Where(f =>
            (f.UserId == userId && f.FriendId == friendId) ||
            (f.UserId == friendId && f.FriendId == userId))
        .ToListAsync();

    if (friendships.Count == 0)
        return Results.NotFound();

    db.Friendships.RemoveRange(friendships);
    await db.SaveChangesAsync();

    try
    {
        await nats.PublishAsync(Subjects.FriendRemoved,
            new FriendRemovedEvent(userId, friendId));
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Failed to publish friend.removed event for {UserId1} and {UserId2}",
            userId, friendId);
    }

    logger.LogInformation("Friendship removed between UserId={UserId} and FriendId={FriendId}", userId, friendId);

    return Results.NoContent();
});

// --- GET /social/friends ---

app.MapGet("/social/friends", async (HttpContext ctx, SocialDbContext db, int page = 1, int pageSize = 20) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    page = Math.Max(1, page);
    pageSize = Math.Clamp(pageSize, 1, 100);

    var query = db.Friendships
        .Where(f => f.UserId == userId && f.Status == FriendshipStatus.Accepted);

    var total = await query.CountAsync();
    var friends = await query
        .OrderByDescending(f => f.CreatedAt)
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync();

    return Results.Ok(new
    {
        items = friends.Select(f => new
        {
            friendId = f.FriendId,
            since = f.CreatedAt
        }),
        page,
        pageSize,
        total
    });
});

// --- GET /social/friends/requests ---

app.MapGet("/social/friends/requests", async (HttpContext ctx, SocialDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var incoming = await db.Friendships
        .Where(f => f.FriendId == userId && f.Status == FriendshipStatus.Pending)
        .OrderByDescending(f => f.CreatedAt)
        .Select(f => new
        {
            id = f.Id,
            fromUserId = f.UserId,
            direction = "incoming",
            createdAt = f.CreatedAt
        })
        .ToListAsync();

    var outgoing = await db.Friendships
        .Where(f => f.UserId == userId && f.Status == FriendshipStatus.Pending)
        .OrderByDescending(f => f.CreatedAt)
        .Select(f => new
        {
            id = f.Id,
            toUserId = f.FriendId,
            direction = "outgoing",
            createdAt = f.CreatedAt
        })
        .ToListAsync();

    return Results.Ok(new { incoming, outgoing });
});

// --- GET /social/friends/{id}/profile ---

app.MapGet("/social/friends/{friendId:guid}/profile", async (Guid friendId, HttpContext ctx, SocialDbContext db,
    IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    // Verify friendship exists (accepted)
    var isFriend = await db.Friendships
        .AnyAsync(f => f.UserId == userId && f.FriendId == friendId && f.Status == FriendshipStatus.Accepted);

    if (!isFriend)
        return Results.NotFound();

    // Fetch habits from Habit Service (internal endpoint)
    List<JsonElement> habits;
    try
    {
        var habitClient = httpClientFactory.CreateClient("HabitService");
        using var response = await habitClient.GetAsync($"/habits/user/{friendId}");
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Habit Service returned {StatusCode} for UserId={FriendId}",
                response.StatusCode, friendId);
            habits = [];
        }
        else
        {
            var habitsArray = await response.Content.ReadFromJsonAsync<List<JsonElement>>(jsonOptions);
            habits = habitsArray ?? [];
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
        logger.LogWarning(ex, "Failed to fetch habits from Habit Service for UserId={FriendId}", friendId);
        habits = [];
    }

    // Get visibility settings for this friend's habits
    var visibilityMap = await db.VisibilitySettings
        .Where(v => v.UserId == friendId)
        .ToDictionaryAsync(v => v.HabitId, v => v.Visibility);

    // Get friend's default visibility preference
    var preference = await db.SocialPreferences
        .FirstOrDefaultAsync(p => p.UserId == friendId);
    var defaultVisibility = preference?.DefaultHabitVisibility ?? HabitVisibility.Private;

    // Filter habits by visibility: show only those visible to friends (or public)
    var visibleHabits = habits.Where(h =>
    {
        if (h.TryGetProperty("id", out var idProp) && Guid.TryParse(idProp.GetString(), out var habitId))
        {
            var visibility = visibilityMap.TryGetValue(habitId, out var v) ? v : defaultVisibility;
            return visibility is HabitVisibility.Friends or HabitVisibility.Public;
        }
        return false;
    }).ToList();

    logger.LogInformation(
        "Visibility filter applied: UserId={UserId}, Viewer={Viewer}, TotalHabits={Total}, VisibleHabits={Visible}, FilteredOut={Filtered}",
        friendId, userId, habits.Count, visibleHabits.Count, habits.Count - visibleHabits.Count);

    return Results.Ok(new
    {
        friendId,
        habits = visibleHabits
    });
});

// --- PUT /social/visibility/{habitId} ---

app.MapPut("/social/visibility/{habitId:guid}", async (Guid habitId, HttpContext ctx, SocialDbContext db,
    IHttpClientFactory httpClientFactory, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var request = await ctx.Request.ReadFromJsonAsync<VisibilityUpdateDto>(jsonOptions);
    if (request is null)
        return Results.BadRequest(new { error = "Request body is required" });

    if (!Enum.IsDefined(request.Visibility))
        return Results.BadRequest(new { error = "Invalid visibility value. Must be private, friends, or public" });

    // Validate ownership: verify user owns this habit via Habit Service
    try
    {
        var habitClient = httpClientFactory.CreateClient("HabitService");
        using var habitsResponse = await habitClient.GetAsync($"/habits/user/{userId}");
        if (habitsResponse.IsSuccessStatusCode)
        {
            var habits = await habitsResponse.Content.ReadFromJsonAsync<List<JsonElement>>(jsonOptions);
            var ownsHabit = habits?.Any(h =>
                h.TryGetProperty("id", out var idProp) &&
                Guid.TryParse(idProp.GetString(), out var hId) &&
                hId == habitId) ?? false;

            if (!ownsHabit)
                return Results.NotFound();
        }
        else
        {
            logger.LogWarning("Habit Service returned {StatusCode} during ownership check for UserId={UserId}",
                habitsResponse.StatusCode, userId);
            return Results.NotFound();
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
        logger.LogWarning(ex, "Failed to validate habit ownership via Habit Service for UserId={UserId}", userId);
        return Results.StatusCode(503);
    }

    var setting = await db.VisibilitySettings
        .FirstOrDefaultAsync(v => v.UserId == userId && v.HabitId == habitId);

    var oldVisibility = setting?.Visibility ?? HabitVisibility.Private;

    if (setting is null)
    {
        setting = new VisibilitySetting
        {
            UserId = userId,
            HabitId = habitId,
            Visibility = request.Visibility
        };
        db.VisibilitySettings.Add(setting);
    }
    else
    {
        setting.Visibility = request.Visibility;
    }

    await db.SaveChangesAsync();

    // Publish visibility.changed event per ADR-001/002
    if (oldVisibility != request.Visibility)
    {
        try
        {
            await nats.PublishAsync(Subjects.VisibilityChanged,
                new VisibilityChangedEvent(userId, habitId,
                    oldVisibility.ToString().ToLowerInvariant(),
                    request.Visibility.ToString().ToLowerInvariant()));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish visibility.changed event for UserId={UserId}, HabitId={HabitId}",
                userId, habitId);
        }
    }

    logger.LogInformation("Visibility changed: UserId={UserId}, HabitId={HabitId}, Old={Old}, New={New}",
        userId, habitId, oldVisibility.ToString().ToLowerInvariant(), request.Visibility.ToString().ToLowerInvariant());

    return Results.Ok(new
    {
        habitId,
        visibility = request.Visibility.ToString().ToLowerInvariant()
    });
});

// --- GET /social/preferences ---

app.MapGet("/social/preferences", async (HttpContext ctx, SocialDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var preference = await db.SocialPreferences
        .FirstOrDefaultAsync(p => p.UserId == userId);

    return Results.Ok(new
    {
        defaultHabitVisibility = (preference?.DefaultHabitVisibility ?? HabitVisibility.Private)
            .ToString().ToLowerInvariant()
    });
});

// --- PUT /social/preferences ---

app.MapPut("/social/preferences", async (HttpContext ctx, SocialDbContext db, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var request = await ctx.Request.ReadFromJsonAsync<PreferencesUpdateDto>(jsonOptions);
    if (request is null)
        return Results.BadRequest(new { error = "Request body is required" });

    if (!Enum.IsDefined(request.DefaultHabitVisibility))
        return Results.BadRequest(new { error = "Invalid visibility value. Must be private, friends, or public" });

    var preference = await db.SocialPreferences
        .FirstOrDefaultAsync(p => p.UserId == userId);

    if (preference is null)
    {
        preference = new SocialPreference
        {
            UserId = userId,
            DefaultHabitVisibility = request.DefaultHabitVisibility
        };
        db.SocialPreferences.Add(preference);
    }
    else
    {
        preference.DefaultHabitVisibility = request.DefaultHabitVisibility;
    }

    await db.SaveChangesAsync();

    logger.LogInformation("Default habit visibility set to {Visibility} for UserId={UserId}",
        request.DefaultHabitVisibility, userId);

    return Results.Ok(new
    {
        defaultHabitVisibility = preference.DefaultHabitVisibility.ToString().ToLowerInvariant()
    });
});

// --- GET /social/visibility (batch) ---

app.MapGet("/social/visibility", async (HttpContext ctx, SocialDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var preference = await db.SocialPreferences
        .FirstOrDefaultAsync(p => p.UserId == userId);
    var defaultVisibility = (preference?.DefaultHabitVisibility ?? HabitVisibility.Private)
        .ToString().ToLowerInvariant();

    var settings = await db.VisibilitySettings
        .Where(v => v.UserId == userId)
        .Select(v => new
        {
            habitId = v.HabitId,
            visibility = v.Visibility.ToString().ToLowerInvariant()
        })
        .ToListAsync();

    return Results.Ok(new
    {
        defaultVisibility,
        habits = settings
    });
});

// --- Internal endpoint: GET /social/internal/friends/{userId1}/{userId2} ---

app.MapGet("/social/internal/friends/{userId1:guid}/{userId2:guid}", async (Guid userId1, Guid userId2, SocialDbContext db) =>
{
    var areFriends = await db.Friendships
        .AnyAsync(f => f.UserId == userId1 && f.FriendId == userId2 && f.Status == FriendshipStatus.Accepted);

    if (!areFriends)
        return Results.NotFound();

    return Results.Ok(new { areFriends = true });
});

// --- Internal endpoint: GET /social/internal/friends/{userId} ---
// Returns all friend IDs for a user (used by Activity Service for feed filtering)

app.MapGet("/social/internal/friends/{userId:guid}", async (Guid userId, SocialDbContext db) =>
{
    var friendIds = await db.Friendships
        .Where(f => f.UserId == userId && f.Status == FriendshipStatus.Accepted)
        .Select(f => f.FriendId)
        .ToListAsync();

    return Results.Ok(new { friendIds });
});

// --- Internal endpoint: GET /social/internal/visible-habits/{userId}?viewer=public|{viewerUserId} ---

app.MapGet("/social/internal/visible-habits/{userId:guid}", async (Guid userId, HttpContext ctx, SocialDbContext db, ILogger<Program> logger) =>
{
    var viewer = ctx.Request.Query["viewer"].FirstOrDefault() ?? "public";

    // Get all visibility settings for this user
    var visibilityMap = await db.VisibilitySettings
        .Where(v => v.UserId == userId)
        .ToDictionaryAsync(v => v.HabitId, v => v.Visibility);

    // Get user's default visibility preference
    var preference = await db.SocialPreferences
        .FirstOrDefaultAsync(p => p.UserId == userId);
    var defaultVisibility = preference?.DefaultHabitVisibility ?? HabitVisibility.Private;

    List<Guid> visibleHabitIds;
    List<Guid> excludedHabitIds;

    if (viewer == "public")
    {
        // Public viewer: explicitly public habits are visible
        visibleHabitIds = visibilityMap
            .Where(kv => kv.Value == HabitVisibility.Public)
            .Select(kv => kv.Key)
            .ToList();

        // Habits explicitly set to non-public must be excluded even when default is public
        excludedHabitIds = visibilityMap
            .Where(kv => kv.Value != HabitVisibility.Public)
            .Select(kv => kv.Key)
            .ToList();
    }
    else if (Guid.TryParse(viewer, out var viewerUserId))
    {
        // Authenticated viewer: check friendship, then filter by visibility
        var isFriend = await db.Friendships
            .AnyAsync(f => f.UserId == viewerUserId && f.FriendId == userId && f.Status == FriendshipStatus.Accepted);

        if (isFriend)
        {
            visibleHabitIds = visibilityMap
                .Where(kv => kv.Value is HabitVisibility.Friends or HabitVisibility.Public)
                .Select(kv => kv.Key)
                .ToList();
            excludedHabitIds = visibilityMap
                .Where(kv => kv.Value is not HabitVisibility.Friends and not HabitVisibility.Public)
                .Select(kv => kv.Key)
                .ToList();
        }
        else
        {
            visibleHabitIds = visibilityMap
                .Where(kv => kv.Value == HabitVisibility.Public)
                .Select(kv => kv.Key)
                .ToList();
            excludedHabitIds = visibilityMap
                .Where(kv => kv.Value != HabitVisibility.Public)
                .Select(kv => kv.Key)
                .ToList();
        }
    }
    else
    {
        visibleHabitIds = visibilityMap
            .Where(kv => kv.Value == HabitVisibility.Public)
            .Select(kv => kv.Key)
            .ToList();
        excludedHabitIds = visibilityMap
            .Where(kv => kv.Value != HabitVisibility.Public)
            .Select(kv => kv.Key)
            .ToList();
    }

    var total = visibilityMap.Count;
    var visible = visibleHabitIds.Count;

    logger.LogInformation(
        "Visibility filter applied: UserId={UserId}, Viewer={Viewer}, TotalHabits={Total}, VisibleHabits={Visible}, FilteredOut={Filtered}",
        userId, viewer, total, visible, total - visible);

    return Results.Ok(new
    {
        habitIds = visibleHabitIds,
        excludedHabitIds,
        defaultVisibility = defaultVisibility.ToString().ToLowerInvariant()
    });
});

app.Run();

// --- Helper methods ---

static bool TryGetUserId(HttpContext ctx, out Guid userId)
{
    userId = Guid.Empty;
    var header = ctx.Request.Headers["X-User-Id"].FirstOrDefault();
    return header is not null && Guid.TryParse(header, out userId);
}

// --- Request DTOs ---

internal record FriendRequestDto(Guid FriendId);
internal record VisibilityUpdateDto(HabitVisibility Visibility);
internal record PreferencesUpdateDto(HabitVisibility DefaultHabitVisibility);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
