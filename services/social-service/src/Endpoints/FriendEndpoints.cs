using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
using Winzy.Common.Http;
using Winzy.Common.Json;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.SocialService.Data;
using Winzy.SocialService.Entities;

namespace Winzy.SocialService.Endpoints;

public static class FriendEndpoints
{
    public static void MapFriendEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/social/friends/request", SendFriendRequest);
        endpoints.MapPut("/social/friends/request/{id:guid}/accept", AcceptFriendRequest);
        endpoints.MapPut("/social/friends/request/{id:guid}/decline", DeclineFriendRequest);
        endpoints.MapDelete("/social/friends/{friendId:guid}", RemoveFriend);
        endpoints.MapGet("/social/friends", ListFriends);
        endpoints.MapGet("/social/friends/requests/count", GetPendingRequestCount);
        endpoints.MapGet("/social/friends/requests", ListFriendRequests);
        endpoints.MapGet("/social/friends/{friendId:guid}/profile", GetFriendProfile);
    }

    private static async Task<IResult> SendFriendRequest(
        HttpContext ctx, SocialDbContext db, NatsEventPublisher nats, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<FriendRequestDto>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
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
    }

    private static async Task<IResult> AcceptFriendRequest(
        Guid id, HttpContext ctx, SocialDbContext db, NatsEventPublisher nats, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
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
    }

    private static async Task<IResult> DeclineFriendRequest(
        Guid id, HttpContext ctx, SocialDbContext db, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var friendship = await db.Friendships
            .FirstOrDefaultAsync(f => f.Id == id && f.FriendId == userId && f.Status == FriendshipStatus.Pending);

        if (friendship is null)
            return Results.NotFound();

        db.Friendships.Remove(friendship);
        await db.SaveChangesAsync();

        logger.LogInformation("Friend request {FriendshipId} declined by UserId={UserId}", id, userId);

        return Results.NoContent();
    }

    private static async Task<IResult> RemoveFriend(
        Guid friendId, HttpContext ctx, SocialDbContext db, NatsEventPublisher nats, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
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
    }

    private static async Task<IResult> ListFriends(
        HttpContext ctx, SocialDbContext db,
        IHttpClientFactory httpClientFactory, ILogger<Program> logger, int page = 1, int pageSize = 20)
    {
        if (!ctx.TryGetUserId(out var userId))
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
        var flameMap = await FetchFlameMap(httpClientFactory, db, friendIds, logger);

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
    }

    private static async Task<IResult> GetPendingRequestCount(HttpContext ctx, SocialDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var count = await db.Friendships
            .CountAsync(f => f.FriendId == userId && f.Status == FriendshipStatus.Pending);

        return Results.Ok(new { count });
    }

    private static async Task<IResult> ListFriendRequests(
        HttpContext ctx, SocialDbContext db,
        IHttpClientFactory httpClientFactory, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
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
    }

    private static async Task<IResult> GetFriendProfile(
        Guid friendId, HttpContext ctx, SocialDbContext db,
        IHttpClientFactory httpClientFactory, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
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
                var habitsArray = await response.Content.ReadFromJsonAsync<List<JsonElement>>(JsonDefaults.CamelCase);
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
    }

    // --- Helper methods ---

    internal static async Task<Dictionary<Guid, ProfileInfo>> FetchProfileMap(
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

            var profiles = await response.Content.ReadFromJsonAsync<List<ProfileInfo>>(JsonDefaults.CamelCase);
            return profiles?.ToDictionary(p => p.UserId) ?? [];
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to fetch batch profiles from Auth Service");
            return [];
        }
    }

    private static async Task<Dictionary<Guid, FlameInfo>> FetchFlameMap(
        IHttpClientFactory httpClientFactory, SocialDbContext db,
        List<Guid> friendIds, ILogger logger)
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

                var habits = await response.Content.ReadFromJsonAsync<List<JsonElement>>(JsonDefaults.CamelCase);
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
}

// --- DTOs ---

internal record FriendRequestDto(Guid FriendId);
internal record FlameInfo(string FlameLevel, double Consistency, bool HabitsUnavailable);
