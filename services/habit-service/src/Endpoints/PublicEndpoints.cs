using System.Security;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.HabitService.Data;
using Winzy.HabitService.Entities;
using Winzy.HabitService.Services;

namespace Winzy.HabitService.Endpoints;

public static class PublicEndpoints
{
    public static void MapPublicEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/habits/public/{username}", GetPublicFlameProfile);
        endpoints.MapGet("/habits/public/{username}/flame.svg", GetFlameBadge);
    }

    // Public endpoint (no auth, used for shareable flame profiles)
    private static async Task<IResult> GetPublicFlameProfile(
        string username, HabitDbContext db, HttpContext ctx, IHttpClientFactory httpClientFactory, ILogger<Program> logger)
    {
        // Resolve username -> userId via the auth service (service-to-service call)
        Guid resolvedUserId;
        try
        {
            var authClient = httpClientFactory.CreateClient("AuthService");
            using var resolveResponse = await authClient.GetAsync($"/auth/internal/resolve/{Uri.EscapeDataString(username)}");
            if (resolveResponse.StatusCode == System.Net.HttpStatusCode.NotFound)
                return Results.NotFound();
            if (!resolveResponse.IsSuccessStatusCode)
            {
                logger.LogWarning("Auth service returned {StatusCode} resolving username {Username}", resolveResponse.StatusCode, username);
                return Results.StatusCode(503);
            }

            var resolved = await resolveResponse.Content.ReadFromJsonAsync<ResolvedUserResponse>();
            if (resolved is null)
                return Results.NotFound();

            resolvedUserId = resolved.UserId;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to resolve username {Username} via auth service", username);
            return Results.StatusCode(503);
        }

        // Check visibility with Social Service (fail-safe: empty habits if unavailable)
        var (visibleHabitIds, excludedHabitIds, defaultIsPublic, socialDegraded) =
            await FetchVisibility(httpClientFactory, resolvedUserId, logger);

        // Share-surface timezone contract: uses UTC — must match /habits/user/{userId} and flame.svg.
        // Authenticated endpoints (stats) use the owner's timezone via X-Timezone header.
        var habits = await db.Habits
            .Where(h => h.UserId == resolvedUserId && h.ArchivedAt == null)
            .Include(h => h.Completions)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync();

        // When default is public, show all habits EXCEPT those explicitly marked non-public.
        // When default is private, show only explicitly visible habits.
        var filteredHabits = defaultIsPublic
            ? habits.Where(h => !excludedHabitIds.Contains(h.Id)).ToList()
            : habits.Where(h => visibleHabitIds.Contains(h.Id)).ToList();

        // Load active, non-expired promises with IsPublicOnFlame=true for visible habits.
        var todayUtc = DateOnly.FromDateTime(DateTime.UtcNow);
        var filteredHabitIds = filteredHabits.Select(h => h.Id).ToList();
        var publicPromises = filteredHabitIds.Count > 0
            ? await db.Promises
                .Where(p => p.UserId == resolvedUserId
                    && p.Status == PromiseStatus.Active
                    && p.IsPublicOnFlame
                    && p.EndDate >= todayUtc
                    && filteredHabitIds.Contains(p.HabitId))
                .ToDictionaryAsync(p => p.HabitId)
            : new Dictionary<Guid, Promise>();

        var result = filteredHabits.Select(h =>
        {
            var completionMap = h.Completions.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
            var consistency = ConsistencyCalculator.Calculate(h, completionMap, TimeZoneInfo.Utc);
            var flameLevel = ConsistencyCalculator.GetFlameLevel(consistency);

            object? promiseData = null;
            if (publicPromises.TryGetValue(h.Id, out var promise))
                promiseData = PromiseEndpoints.MapPromiseToPublicResponse(promise, consistency);

            return new
            {
                id = h.Id,
                name = h.Name,
                icon = h.Icon,
                color = h.Color,
                consistency,
                flameLevel = flameLevel.ToString().ToLowerInvariant(),
                promise = promiseData
            };
        });

        return Results.Ok(new { username, habits = result, degraded = socialDegraded });
    }

    // SVG flame badge endpoint (embeddable, no auth)
    private static async Task<IResult> GetFlameBadge(
        string username, HabitDbContext db, HttpContext ctx, IHttpClientFactory httpClientFactory, ILogger<Program> logger)
    {
        // Resolve username -> userId via the auth service
        Guid resolvedUserId;
        try
        {
            var authClient = httpClientFactory.CreateClient("AuthService");
            using var resolveResponse = await authClient.GetAsync($"/auth/internal/resolve/{Uri.EscapeDataString(username)}");
            if (resolveResponse.StatusCode == System.Net.HttpStatusCode.NotFound)
                return Results.NotFound();
            if (!resolveResponse.IsSuccessStatusCode)
            {
                logger.LogWarning("Auth service returned {StatusCode} resolving username {Username} for badge", resolveResponse.StatusCode, username);
                return Results.StatusCode(503);
            }

            var resolved = await resolveResponse.Content.ReadFromJsonAsync<ResolvedUserResponse>();
            if (resolved is null)
                return Results.NotFound();

            resolvedUserId = resolved.UserId;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to resolve username {Username} for flame badge", username);
            return Results.StatusCode(503);
        }

        // Check visibility with Social Service (fail-safe: show "none" flame if unavailable)
        var (visibleHabitIds, excludedHabitIds, defaultIsPublic, _) =
            await FetchVisibility(httpClientFactory, resolvedUserId, logger);

        var allHabits = await db.Habits
            .Where(h => h.UserId == resolvedUserId && h.ArchivedAt == null)
            .Include(h => h.Completions)
            .ToListAsync();

        var habits = defaultIsPublic
            ? allHabits.Where(h => !excludedHabitIds.Contains(h.Id)).ToList()
            : allHabits.Where(h => visibleHabitIds.Contains(h.Id)).ToList();

        // Share-surface timezone contract: uses UTC — must match /habits/public/{username} and /habits/user/{userId}.
        // Calculate aggregate consistency across visible habits
        double aggregateConsistency = 0;
        if (habits.Count > 0)
        {
            var totalConsistency = habits.Sum(h =>
            {
                var completionMap = h.Completions.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
                return ConsistencyCalculator.Calculate(h, completionMap, TimeZoneInfo.Utc);
            });
            aggregateConsistency = totalConsistency / habits.Count;
        }

        var flameLevel = ConsistencyCalculator.GetFlameLevel(aggregateConsistency);
        var flameLevelName = flameLevel.ToString().ToLowerInvariant();

        // Map flame level to SVG colors
        var (flameColor, glowColor) = flameLevel switch
        {
            FlameLevel.None => ("#9CA3AF", "#D1D5DB"),
            FlameLevel.Ember => ("#D97706", "#FCD34D"),
            FlameLevel.Steady => ("#EA580C", "#FDBA74"),
            FlameLevel.Strong => ("#F97316", "#FCA5A5"),
            FlameLevel.Blazing => ("#DC2626", "#FECACA"),
            _ => ("#9CA3AF", "#D1D5DB")
        };

        var consistencyText = $"{Math.Round(aggregateConsistency)}%";
        var svg = $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="160" height="32" viewBox="0 0 160 32">
              <defs>
                <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="#1C1917"/>
                  <stop offset="100%" stop-color="#292524"/>
                </linearGradient>
              </defs>
              <rect width="160" height="32" rx="6" fill="url(#bg)"/>
              <!-- Flame icon -->
              <circle cx="20" cy="16" r="8" fill="{glowColor}" opacity="0.25"/>
              <path d="M20 8 C20 8, 14 14, 14 18 C14 21.3, 16.7 24, 20 24 C23.3 24, 26 21.3, 26 18 C26 14, 20 8, 20 8Z"
                    fill="{flameColor}" opacity="0.9"/>
              <path d="M20 13 C20 13, 17 16, 17 18.5 C17 20.4, 18.3 22, 20 22 C21.7 22, 23 20.4, 23 18.5 C23 16, 20 13, 20 13Z"
                    fill="{glowColor}" opacity="0.7"/>
              <!-- Text -->
              <text x="36" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="12" font-weight="600" fill="#FAFAF9">
                {SecurityElement.Escape(username)}
              </text>
              <!-- Consistency badge -->
              <rect x="108" y="7" width="44" height="18" rx="9" fill="{flameColor}" opacity="0.2"/>
              <text x="130" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="{flameColor}" text-anchor="middle">
                {consistencyText}
              </text>
            </svg>
            """;

        ctx.Response.Headers.CacheControl = "public, max-age=300, s-maxage=300";
        ctx.Response.Headers["Content-Type"] = "image/svg+xml";
        return Results.Content(svg, "image/svg+xml");
    }

    // --- Shared helpers ---

    internal static async Task<(HashSet<Guid> VisibleHabitIds, HashSet<Guid> ExcludedHabitIds, bool DefaultIsPublic, bool Degraded)>
        FetchVisibility(IHttpClientFactory httpClientFactory, Guid userId, ILogger logger)
    {
        try
        {
            var socialClient = httpClientFactory.CreateClient("SocialService");
            using var visResponse = await socialClient.GetAsync(
                $"/social/internal/visible-habits/{userId}?viewer=public");
            if (!visResponse.IsSuccessStatusCode)
            {
                logger.LogWarning("Social service returned {StatusCode} for visibility check, failing safe", visResponse.StatusCode);
                return ([], [], false, true);
            }

            var visData = await visResponse.Content.ReadFromJsonAsync<VisibilityResponse>();
            return (
                visData?.HabitIds?.ToHashSet() ?? [],
                visData?.ExcludedHabitIds?.ToHashSet() ?? [],
                string.Equals(visData?.DefaultVisibility, "public", StringComparison.OrdinalIgnoreCase),
                false
            );
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to check visibility via social service for user {UserId}, failing safe", userId);
            return ([], [], false, true);
        }
    }
}

// --- Response DTOs ---

internal record ResolvedUserResponse(Guid UserId);
internal record VisibilityResponse(List<Guid>? HabitIds, List<Guid>? ExcludedHabitIds, string? DefaultVisibility);
