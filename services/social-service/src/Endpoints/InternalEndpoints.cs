using Microsoft.EntityFrameworkCore;
using Winzy.SocialService.Data;
using Winzy.SocialService.Entities;

namespace Winzy.SocialService.Endpoints;

public static class InternalEndpoints
{
    public static void MapInternalEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/social/internal/export/{userId:guid}", ExportUserData);
        endpoints.MapGet("/social/internal/friends/{userId1:guid}/{userId2:guid}", CheckFriendship);
        endpoints.MapGet("/social/internal/friends/{userId:guid}", GetFriendIds);
    }

    private static async Task<IResult> ExportUserData(Guid userId, SocialDbContext db)
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
    }

    private static async Task<IResult> CheckFriendship(Guid userId1, Guid userId2, SocialDbContext db)
    {
        var areFriends = await db.Friendships
            .AnyAsync(f => f.UserId == userId1 && f.FriendId == userId2 && f.Status == FriendshipStatus.Accepted);

        if (!areFriends)
            return Results.NotFound();

        return Results.Ok(new { areFriends = true });
    }

    private static async Task<IResult> GetFriendIds(Guid userId, SocialDbContext db)
    {
        var friendIds = await db.Friendships
            .Where(f => f.UserId == userId && f.Status == FriendshipStatus.Accepted)
            .Select(f => f.FriendId)
            .ToListAsync();

        return Results.Ok(new { friendIds });
    }
}
