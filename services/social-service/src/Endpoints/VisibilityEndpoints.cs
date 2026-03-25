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

public static class VisibilityEndpoints
{
    public static void MapVisibilityEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPut("/social/visibility/{habitId:guid}", SetHabitVisibility);
        endpoints.MapGet("/social/preferences", GetPreferences);
        endpoints.MapPut("/social/preferences", UpdatePreferences);
        endpoints.MapGet("/social/visibility", GetBatchVisibility);
        endpoints.MapGet("/social/internal/visible-habits/{userId:guid}", GetVisibleHabits);
    }

    private static async Task<IResult> SetHabitVisibility(
        Guid habitId, HttpContext ctx, SocialDbContext db,
        IHttpClientFactory httpClientFactory, NatsEventPublisher nats, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<VisibilityUpdateDto>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
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
                var habits = await habitsResponse.Content.ReadFromJsonAsync<List<JsonElement>>(JsonDefaults.CamelCase);
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
    }

    private static async Task<IResult> GetPreferences(HttpContext ctx, SocialDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var preference = await db.SocialPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId);

        return Results.Ok(new
        {
            defaultHabitVisibility = (preference?.DefaultHabitVisibility ?? HabitVisibility.Private)
                .ToString().ToLowerInvariant()
        });
    }

    private static async Task<IResult> UpdatePreferences(
        HttpContext ctx, SocialDbContext db, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<PreferencesUpdateDto>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
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
    }

    private static async Task<IResult> GetBatchVisibility(HttpContext ctx, SocialDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
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
    }

    private static async Task<IResult> GetVisibleHabits(
        Guid userId, HttpContext ctx, SocialDbContext db, ILogger<Program> logger)
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
    }
}

// --- DTOs ---

internal record VisibilityUpdateDto(HabitVisibility Visibility);
internal record PreferencesUpdateDto(HabitVisibility DefaultHabitVisibility);
