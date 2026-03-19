using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
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

builder.AddObservability("social-service");
builder.Services.AddServiceDatabase<SocialDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddHostedService<HabitCreatedSubscriber>();
builder.Services.AddHostedService<HabitArchivedSubscriber>();
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

builder.Services.AddHttpClient("AuthService", client =>
{
    var authUrl = builder.Configuration["Services:AuthServiceUrl"] ?? "http://auth-service:5001";
    client.BaseAddress = new Uri(authUrl);
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

    FriendRequestDto? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<FriendRequestDto>(jsonOptions);
    }
    catch (JsonException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
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
    catch (Exception ex) when (ex is NatsException or OperationCanceledException)
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
    catch (Exception ex) when (ex is NatsException or OperationCanceledException)
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
    catch (Exception ex) when (ex is NatsException or OperationCanceledException)
    {
        logger.LogWarning(ex, "Failed to publish friend.removed event for {UserId1} and {UserId2}",
            userId, friendId);
    }

    logger.LogInformation("Friendship removed between UserId={UserId} and FriendId={FriendId}", userId, friendId);

    return Results.NoContent();
});

// --- GET /social/friends ---

app.MapGet("/social/friends", async (HttpContext ctx, SocialDbContext db,
    IHttpClientFactory httpClientFactory, ILogger<Program> logger, int page = 1, int pageSize = 20) =>
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

    // Enrich with profile data from auth service
    var friendIds = friends.Select(f => f.FriendId).ToList();
    var profileMap = await FetchProfileMap(httpClientFactory, friendIds, logger);

    // Enrich with flame/consistency data from habit service
    var flameMap = await FetchFlameMap(httpClientFactory, db, friendIds, jsonOptions, logger);

    return Results.Ok(new
    {
        items = friends.Select(f =>
        {
            profileMap.TryGetValue(f.FriendId, out var profile);
            flameMap.TryGetValue(f.FriendId, out var flame);
            return new
            {
                friendId = f.FriendId,
                since = f.CreatedAt,
                username = profile?.Username,
                displayName = profile?.DisplayName,
                avatarUrl = (string?)null,
                flameLevel = flame?.FlameLevel ?? "none",
                consistency = flame?.Consistency ?? 0.0,
                habitsUnavailable = flame?.HabitsUnavailable ?? false
            };
        }),
        page,
        pageSize,
        total
    });
});

// --- GET /social/friends/requests/count ---

app.MapGet("/social/friends/requests/count", async (HttpContext ctx, SocialDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var count = await db.Friendships
        .CountAsync(f => f.FriendId == userId && f.Status == FriendshipStatus.Pending);

    return Results.Ok(new { count });
});

// --- GET /social/friends/requests ---

app.MapGet("/social/friends/requests", async (HttpContext ctx, SocialDbContext db,
    IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var incomingRaw = await db.Friendships
        .Where(f => f.FriendId == userId && f.Status == FriendshipStatus.Pending)
        .OrderByDescending(f => f.CreatedAt)
        .ToListAsync();

    var outgoingRaw = await db.Friendships
        .Where(f => f.UserId == userId && f.Status == FriendshipStatus.Pending)
        .OrderByDescending(f => f.CreatedAt)
        .ToListAsync();

    // Batch-fetch profiles for all user IDs in requests
    var allUserIds = incomingRaw.Select(f => f.UserId)
        .Concat(outgoingRaw.Select(f => f.FriendId))
        .Distinct().ToList();
    var profileMap = await FetchProfileMap(httpClientFactory, allUserIds, logger);

    var incoming = incomingRaw.Select(f =>
    {
        profileMap.TryGetValue(f.UserId, out var profile);
        return new
        {
            id = f.Id,
            fromUserId = f.UserId,
            direction = "incoming",
            createdAt = f.CreatedAt,
            fromUsername = profile?.Username,
            fromDisplayName = profile?.DisplayName
        };
    });

    var outgoing = outgoingRaw.Select(f =>
    {
        profileMap.TryGetValue(f.FriendId, out var profile);
        return new
        {
            id = f.Id,
            toUserId = f.FriendId,
            direction = "outgoing",
            createdAt = f.CreatedAt,
            toUsername = profile?.Username,
            toDisplayName = profile?.DisplayName
        };
    });

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
    var habitsUnavailable = false;
    try
    {
        var habitClient = httpClientFactory.CreateClient("HabitService");
        using var response = await habitClient.GetAsync($"/habits/user/{friendId}");
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Habit Service returned {StatusCode} for UserId={FriendId}",
                response.StatusCode, friendId);
            habits = [];
            habitsUnavailable = true;
        }
        else
        {
            var habitsArray = await response.Content.ReadFromJsonAsync<List<JsonElement>>(jsonOptions);
            habits = habitsArray ?? [];
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
    {
        logger.LogWarning(ex, "Failed to fetch habits from Habit Service for UserId={FriendId}", friendId);
        habits = [];
        habitsUnavailable = true;
    }

    // Get visibility settings for this friend's habits
    var visibilityMap = await db.VisibilitySettings
        .Where(v => v.UserId == friendId)
        .ToDictionaryAsync(v => v.HabitId, v => v.Visibility);

    // Get friend's default visibility preference
    var preference = await db.SocialPreferences
        .FirstOrDefaultAsync(p => p.UserId == friendId);
    var defaultVisibility = preference?.DefaultHabitVisibility ?? HabitVisibility.Private;

    // Filter habits by visibility and use pre-computed consistency/flameLevel from habit-service
    var visibleHabits = habits
        .Where(h =>
        {
            if (h.TryGetProperty("id", out var idProp) && Guid.TryParse(idProp.GetString(), out var habitId))
            {
                var visibility = visibilityMap.TryGetValue(habitId, out var v) ? v : defaultVisibility;
                return visibility is HabitVisibility.Friends or HabitVisibility.Public;
            }
            return false;
        })
        .Select(h =>
        {
            var id = h.GetProperty("id").GetString()!;
            var name = h.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            var icon = h.TryGetProperty("icon", out var ic) && ic.ValueKind != JsonValueKind.Null ? ic.GetString() : null;
            var color = h.TryGetProperty("color", out var co) && co.ValueKind != JsonValueKind.Null ? co.GetString() : null;

            // Use pre-computed values from habit-service (consistency calculator with hysteresis)
            var consistency = h.TryGetProperty("consistency", out var cons) ? cons.GetDouble() : 0.0;
            var flameLevel = h.TryGetProperty("flameLevel", out var fl) ? fl.GetString() ?? "none" : "none";

            return new
            {
                id,
                name,
                icon,
                color,
                consistency,
                flameLevel
            };
        })
        .ToList();

    logger.LogInformation(
        "Visibility filter applied: UserId={UserId}, Viewer={Viewer}, TotalHabits={Total}, VisibleHabits={Visible}, FilteredOut={Filtered}",
        friendId, userId, habits.Count, visibleHabits.Count, habits.Count - visibleHabits.Count);

    return Results.Ok(new
    {
        friendId,
        habits = visibleHabits,
        habitsUnavailable
    });
});

// --- PUT /social/visibility/{habitId} ---

app.MapPut("/social/visibility/{habitId:guid}", async (Guid habitId, HttpContext ctx, SocialDbContext db,
    IHttpClientFactory httpClientFactory, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    VisibilityUpdateDto? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<VisibilityUpdateDto>(jsonOptions);
    }
    catch (JsonException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
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
        else if (habitsResponse.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            logger.LogInformation("Habit Service returned 404 during ownership check for UserId={UserId} — user has no habits",
                userId);
            return Results.NotFound();
        }
        else
        {
            logger.LogWarning("Habit Service returned {StatusCode} during ownership check for UserId={UserId}",
                (int)habitsResponse.StatusCode, userId);
            return Results.StatusCode(503);
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
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
        catch (Exception ex) when (ex is NatsException or OperationCanceledException)
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

    PreferencesUpdateDto? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<PreferencesUpdateDto>(jsonOptions);
    }
    catch (JsonException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
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

// --- Internal export endpoint (service-to-service, per export-contracts.md) ---

app.MapGet("/social/internal/export/{userId:guid}", async (Guid userId, SocialDbContext db) =>
{
    var hasFriendships = await db.Friendships.AnyAsync(f => f.UserId == userId || f.FriendId == userId);
    var hasPreferences = await db.SocialPreferences.AnyAsync(p => p.UserId == userId);
    var hasVisibility = await db.VisibilitySettings.AnyAsync(v => v.UserId == userId);

    if (!hasFriendships && !hasPreferences && !hasVisibility)
        return Results.NotFound();

    var friends = await db.Friendships
        .Where(f => f.UserId == userId && f.Status == FriendshipStatus.Accepted)
        .OrderBy(f => f.CreatedAt)
        .Select(f => new
        {
            friendUserId = f.FriendId,
            connectedAt = f.CreatedAt
        })
        .ToListAsync();

    var pendingRequests = await db.Friendships
        .Where(f => (f.UserId == userId || f.FriendId == userId) && f.Status == FriendshipStatus.Pending)
        .OrderBy(f => f.CreatedAt)
        .Select(f => new
        {
            direction = f.UserId == userId ? "sent" : "received",
            otherUserId = f.UserId == userId ? f.FriendId : f.UserId,
            requestedAt = f.CreatedAt
        })
        .ToListAsync();

    var preference = await db.SocialPreferences
        .FirstOrDefaultAsync(p => p.UserId == userId);

    var visibilitySettings = await db.VisibilitySettings
        .Where(v => v.UserId == userId)
        .Select(v => new
        {
            habitId = v.HabitId,
            visibility = v.Visibility.ToString().ToLowerInvariant()
        })
        .ToListAsync();

    return Results.Ok(new
    {
        service = "social",
        data = new
        {
            friends,
            pendingRequests,
            preferences = new
            {
                defaultHabitVisibility = (preference?.DefaultHabitVisibility ?? HabitVisibility.Private)
                    .ToString().ToLowerInvariant()
            },
            visibilitySettings
        }
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

static async Task<Dictionary<Guid, ProfileInfo>> FetchProfileMap(
    IHttpClientFactory httpClientFactory, List<Guid> userIds, ILogger logger)
{
    if (userIds.Count == 0)
        return [];

    try
    {
        var authClient = httpClientFactory.CreateClient("AuthService");
        using var response = await authClient.PostAsJsonAsync("/auth/internal/profiles",
            new { userIds });

        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Auth Service batch profiles returned {StatusCode}", response.StatusCode);
            return [];
        }

        var profiles = await response.Content.ReadFromJsonAsync<List<ProfileInfo>>(
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        return profiles?.ToDictionary(p => p.UserId) ?? [];
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
    {
        logger.LogWarning(ex, "Failed to fetch batch profiles from Auth Service");
        return [];
    }
}

static async Task<Dictionary<Guid, FlameInfo>> FetchFlameMap(
    IHttpClientFactory httpClientFactory, SocialDbContext db,
    List<Guid> friendIds, JsonSerializerOptions jsonOptions, ILogger logger)
{
    if (friendIds.Count == 0)
        return [];

    var result = new Dictionary<Guid, FlameInfo>();
    var habitClient = httpClientFactory.CreateClient("HabitService");

    // Batch-fetch visibility settings and preferences for all friends
    var visibilityMap = await db.VisibilitySettings
        .Where(v => friendIds.Contains(v.UserId))
        .ToListAsync();
    var visibilityLookup = visibilityMap
        .GroupBy(v => v.UserId)
        .ToDictionary(g => g.Key, g => g.ToDictionary(v => v.HabitId, v => v.Visibility));

    var preferences = await db.SocialPreferences
        .Where(p => friendIds.Contains(p.UserId))
        .ToDictionaryAsync(p => p.UserId, p => p.DefaultHabitVisibility);

    // Fetch habits per friend in parallel
    var tasks = friendIds.Select(async friendId =>
    {
        try
        {
            using var response = await habitClient.GetAsync($"/habits/user/{friendId}");
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Habit Service returned {StatusCode} for flame enrichment of UserId={FriendId}",
                    response.StatusCode, friendId);
                return (friendId, new FlameInfo("none", 0.0, true));
            }

            var habits = await response.Content.ReadFromJsonAsync<List<JsonElement>>(jsonOptions);
            if (habits is null || habits.Count == 0)
                return (friendId, new FlameInfo("none", 0.0, false));

            // Filter by visibility (same logic as friend profile endpoint)
            var friendVisibility = visibilityLookup.TryGetValue(friendId, out var fv) ? fv : [];
            var defaultVis = preferences.TryGetValue(friendId, out var dv) ? dv : HabitVisibility.Private;

            var visibleHabits = habits.Where(h =>
            {
                if (h.TryGetProperty("id", out var idProp) && Guid.TryParse(idProp.GetString(), out var habitId))
                {
                    var visibility = friendVisibility.TryGetValue(habitId, out var v) ? v : defaultVis;
                    return visibility is HabitVisibility.Friends or HabitVisibility.Public;
                }
                return false;
            }).ToList();

            if (visibleHabits.Count == 0)
                return (friendId, new FlameInfo("none", 0.0, false));

            // Aggregate: best flame level, average consistency
            var flameLevelRank = new Dictionary<string, int>
            {
                ["none"] = 0,
                ["ember"] = 1,
                ["steady"] = 2,
                ["strong"] = 3,
                ["blazing"] = 4
            };
            var bestFlame = "none";
            var bestRank = 0;
            var totalConsistency = 0.0;

            foreach (var h in visibleHabits)
            {
                var fl = h.TryGetProperty("flameLevel", out var flProp) ? flProp.GetString() ?? "none" : "none";
                var cons = h.TryGetProperty("consistency", out var consProp) && consProp.ValueKind == JsonValueKind.Number
                    ? consProp.GetDouble() : 0.0;

                // Unknown levels (e.g. future "inferno") rank above all known levels
                var rank = flameLevelRank.TryGetValue(fl, out var r) ? r : int.MaxValue;
                if (rank > bestRank)
                {
                    bestRank = rank;
                    bestFlame = fl;
                }
                totalConsistency += cons;
            }

            var avgConsistency = Math.Round(totalConsistency / visibleHabits.Count, 1);
            return (friendId, new FlameInfo(bestFlame, avgConsistency, false));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to fetch habits for flame enrichment of UserId={FriendId}", friendId);
            return (friendId, new FlameInfo("none", 0.0, true));
        }
    });

    foreach (var (friendId, flame) in await Task.WhenAll(tasks))
        result[friendId] = flame;

    return result;
}

// --- Request/Response DTOs ---

internal record FriendRequestDto(Guid FriendId);
internal record VisibilityUpdateDto(HabitVisibility Visibility);
internal record PreferencesUpdateDto(HabitVisibility DefaultHabitVisibility);
internal record ProfileInfo(Guid UserId, string Username, string? DisplayName);
internal record FlameInfo(string FlameLevel, double Consistency, bool HabitsUnavailable);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
