using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.Common.Http;
using Winzy.Common.Json;
using Winzy.Contracts;
using Winzy.SocialService.Data;
using Winzy.SocialService.Entities;

namespace Winzy.SocialService.Endpoints;

public static class WitnessLinkEndpoints
{
    public static void MapWitnessLinkEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/social/witness-links", CreateWitnessLink);
        endpoints.MapGet("/social/witness-links", ListWitnessLinks);
        endpoints.MapPut("/social/witness-links/{id:guid}", UpdateWitnessLink);
        endpoints.MapDelete("/social/witness-links/{id:guid}", RevokeWitnessLink);
        endpoints.MapPost("/social/witness-links/{id:guid}/rotate", RotateToken);
        endpoints.MapGet("/social/witness/{token}", ViewWitnessLink);
    }

    private static async Task<IResult> CreateWitnessLink(
        HttpContext ctx, SocialDbContext db, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<WitnessLinkCreateDto>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null)
            return Results.BadRequest(new { error = "Request body is required" });

        if (request.Label is { Length: > 100 })
            return Results.BadRequest(new { error = "Label must be 100 characters or fewer" });

        var token = GenerateWitnessToken();

        var link = new WitnessLink
        {
            Id = Guid.NewGuid(),
            OwnerId = userId,
            Token = token,
            Label = request.Label?.Trim()
        };

        db.WitnessLinks.Add(link);

        if (request.HabitIds is { Count: > 0 })
        {
            var uniqueIds = request.HabitIds.Distinct().ToList();
            foreach (var habitId in uniqueIds)
            {
                db.WitnessLinkHabits.Add(new WitnessLinkHabit
                {
                    WitnessLinkId = link.Id,
                    HabitId = habitId
                });
            }
        }

        await db.SaveChangesAsync();

        logger.LogInformation("Witness link created: LinkId={LinkId}, OwnerId={OwnerId}",
            link.Id, userId);

        var habitIds = await db.WitnessLinkHabits
            .Where(wh => wh.WitnessLinkId == link.Id)
            .Select(wh => wh.HabitId)
            .ToListAsync();

        return Results.Created($"/social/witness-links/{link.Id}", new
        {
            id = link.Id,
            token = link.Token,
            label = link.Label,
            habitIds,
            createdAt = link.CreatedAt
        });
    }

    private static async Task<IResult> ListWitnessLinks(HttpContext ctx, SocialDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var links = await db.WitnessLinks
            .Where(w => w.OwnerId == userId && w.RevokedAt == null)
            .OrderByDescending(w => w.CreatedAt)
            .ToListAsync();

        var linkIds = links.Select(l => l.Id).ToList();
        var habitMap = await db.WitnessLinkHabits
            .Where(wh => linkIds.Contains(wh.WitnessLinkId))
            .GroupBy(wh => wh.WitnessLinkId)
            .ToDictionaryAsync(g => g.Key, g => g.Select(wh => wh.HabitId).ToList());

        return Results.Ok(new
        {
            items = links.Select(l => new
            {
                id = l.Id,
                token = l.Token,
                label = l.Label,
                habitIds = habitMap.TryGetValue(l.Id, out var ids) ? ids : new List<Guid>(),
                createdAt = l.CreatedAt
            })
        });
    }

    private static async Task<IResult> UpdateWitnessLink(
        Guid id, HttpContext ctx, SocialDbContext db, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<WitnessLinkUpdateDto>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null)
            return Results.BadRequest(new { error = "Request body is required" });

        if (request.Label is { Length: > 100 })
            return Results.BadRequest(new { error = "Label must be 100 characters or fewer" });

        var link = await db.WitnessLinks
            .FirstOrDefaultAsync(w => w.Id == id && w.OwnerId == userId && w.RevokedAt == null);

        if (link is null)
            return Results.NotFound();

        if (request.Label is not null)
            link.Label = request.Label.Trim();

        if (request.HabitIds is not null)
        {
            // Replace the entire habit allowlist
            var existing = await db.WitnessLinkHabits
                .Where(wh => wh.WitnessLinkId == id)
                .ToListAsync();
            db.WitnessLinkHabits.RemoveRange(existing);

            foreach (var habitId in request.HabitIds.Distinct())
            {
                db.WitnessLinkHabits.Add(new WitnessLinkHabit
                {
                    WitnessLinkId = id,
                    HabitId = habitId
                });
            }
        }

        await db.SaveChangesAsync();

        logger.LogInformation("Witness link updated: LinkId={LinkId}, OwnerId={OwnerId}",
            id, userId);

        var habitIds = await db.WitnessLinkHabits
            .Where(wh => wh.WitnessLinkId == id)
            .Select(wh => wh.HabitId)
            .ToListAsync();

        return Results.Ok(new
        {
            id = link.Id,
            token = link.Token,
            label = link.Label,
            habitIds,
            createdAt = link.CreatedAt
        });
    }

    private static async Task<IResult> RevokeWitnessLink(
        Guid id, HttpContext ctx, SocialDbContext db, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var link = await db.WitnessLinks
            .FirstOrDefaultAsync(w => w.Id == id && w.OwnerId == userId && w.RevokedAt == null);

        if (link is null)
            return Results.NotFound();

        link.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();

        logger.LogInformation("Witness link revoked: LinkId={LinkId}, OwnerId={OwnerId}",
            id, userId);

        return Results.NoContent();
    }

    private static async Task<IResult> RotateToken(
        Guid id, HttpContext ctx, SocialDbContext db, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var link = await db.WitnessLinks
            .FirstOrDefaultAsync(w => w.Id == id && w.OwnerId == userId && w.RevokedAt == null);

        if (link is null)
            return Results.NotFound();

        link.Token = GenerateWitnessToken();
        await db.SaveChangesAsync();

        logger.LogInformation("Witness link token rotated: LinkId={LinkId}, OwnerId={OwnerId}",
            id, userId);

        var habitIds = await db.WitnessLinkHabits
            .Where(wh => wh.WitnessLinkId == id)
            .Select(wh => wh.HabitId)
            .ToListAsync();

        return Results.Ok(new
        {
            id = link.Id,
            token = link.Token,
            label = link.Label,
            habitIds,
            createdAt = link.CreatedAt
        });
    }

    private static async Task<IResult> ViewWitnessLink(
        string token, HttpContext ctx, SocialDbContext db,
        IHttpClientFactory httpClientFactory, ILogger<Program> logger)
    {
        // Prevent search engine indexing of witness links (spec: "must not be indexable or searchable")
        ctx.Response.Headers["X-Robots-Tag"] = "noindex";
        ctx.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
        ctx.Response.Headers["Pragma"] = "no-cache";

        // Reject obviously invalid tokens early (valid tokens are 43 chars base64url for 32 bytes)
        if (string.IsNullOrEmpty(token) || token.Length < 20 || token.Length > 64)
            return Results.NotFound(new { error = "This witness link is not available" });

        // Query WITHOUT RevokedAt filter — ensures identical DB index lookup for both
        // revoked and unknown tokens, eliminating timing oracle on revocation state
        var link = await db.WitnessLinks
            .FirstOrDefaultAsync(w => w.Token == token);

        // Same 404 response for unknown, revoked, or malformed token — no info leakage
        if (link is null || link.RevokedAt is not null)
            return Results.NotFound(new { error = "This witness link is not available" });

        // Get allowed habit IDs for this link
        var allowedHabitIds = await db.WitnessLinkHabits
            .Where(wh => wh.WitnessLinkId == link.Id)
            .Select(wh => wh.HabitId)
            .ToListAsync();

        // Fetch habits from habit-service
        List<JsonElement> habits;
        bool habitsUnavailable;
        try
        {
            var habitClient = httpClientFactory.CreateClient("HabitService");
            using var response = await habitClient.GetAsync($"/habits/user/{link.OwnerId}");
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Habit Service returned {StatusCode} for witness link: LinkId={LinkId}",
                    response.StatusCode, link.Id);
                habits = [];
                habitsUnavailable = true;
            }
            else
            {
                var habitsArray = await response.Content.ReadFromJsonAsync<List<JsonElement>>(JsonDefaults.CamelCase);
                habits = habitsArray ?? [];
                habitsUnavailable = false;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to fetch habits from Habit Service for witness link: LinkId={LinkId}", link.Id);
            habits = [];
            habitsUnavailable = true;
        }

        // Filter to only allowed habits (by the per-link allowlist)
        var filteredHabits = allowedHabitIds.Count > 0
            ? habits.Where(h =>
                h.TryGetProperty("id", out var idProp) &&
                Guid.TryParse(idProp.GetString(), out var habitId) &&
                allowedHabitIds.Contains(habitId))
              .ToList()
            : []; // No habits selected = empty witness page

        // Build witness-safe habit response (only what the anonymous viewer needs)
        var witnessHabits = filteredHabits.Select(h =>
        {
            var id = h.GetProperty("id").GetString()!;
            var name = h.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            var icon = h.TryGetProperty("icon", out var ic) && ic.ValueKind != JsonValueKind.Null ? ic.GetString() : null;
            var color = h.TryGetProperty("color", out var co) && co.ValueKind != JsonValueKind.Null ? co.GetString() : null;
            var consistency = h.TryGetProperty("consistency", out var cons) ? cons.GetDouble() : 0.0;
            var flameLevel = h.TryGetProperty("flameLevel", out var fl) ? fl.GetString() ?? "none" : "none";
            var promise = h.TryGetProperty("promise", out var pr) && pr.ValueKind != JsonValueKind.Null ? (object?)pr : null;

            return new
            {
                id,
                name,
                icon,
                color,
                consistency,
                flameLevel,
                promise
            };
        }).ToList();

        // Fetch owner profile for display
        string? ownerUsername = null;
        string? ownerDisplayName = null;
        try
        {
            var authClient = httpClientFactory.CreateClient("AuthService");
            using var profileResponse = await authClient.PostAsJsonAsync("/auth/internal/profiles",
                new { userIds = new[] { link.OwnerId } });
            if (profileResponse.IsSuccessStatusCode)
            {
                var profiles = await profileResponse.Content.ReadFromJsonAsync<List<ProfileInfo>>(JsonDefaults.CamelCase);
                var profile = profiles?.FirstOrDefault();
                ownerUsername = profile?.Username;
                ownerDisplayName = profile?.DisplayName;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex, "Failed to fetch owner profile for witness link: LinkId={LinkId}", link.Id);
        }

        // Log access without the token value (privacy)
        logger.LogInformation("Witness link accessed: LinkId={LinkId}, OwnerId={OwnerId}, HabitsShown={Count}",
            link.Id, link.OwnerId, witnessHabits.Count);

        return Results.Ok(new
        {
            ownerUsername,
            ownerDisplayName,
            habits = witnessHabits,
            habitsUnavailable
        });
    }

    private static string GenerateWitnessToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}

// --- DTOs ---

internal record WitnessLinkCreateDto(string? Label, List<Guid>? HabitIds);
internal record WitnessLinkUpdateDto(string? Label, List<Guid>? HabitIds);
