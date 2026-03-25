using Microsoft.EntityFrameworkCore;
using Winzy.Common.Http;
using Winzy.Common.Json;
using Winzy.HabitService.Data;
using Winzy.HabitService.Entities;
using Winzy.HabitService.Services;

namespace Winzy.HabitService.Endpoints;

public static class PromiseEndpoints
{
    public static void MapPromiseEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/habits/{habitId:guid}/promise", CreatePromise);
        endpoints.MapGet("/habits/{habitId:guid}/promise", GetPromise);
        endpoints.MapDelete("/habits/{habitId:guid}/promise", CancelPromise);
        endpoints.MapPatch("/habits/{habitId:guid}/promise/visibility", ToggleVisibility);
    }

    private static async Task<IResult> CreatePromise(Guid habitId, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId && h.ArchivedAt == null);
        if (habit is null)
            return Results.NotFound();

        var (request, error) = await ctx.Request.TryReadBodyAsync<CreatePromiseRequest>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null)
            return Results.BadRequest(new { error = "Request body is required" });

        // Validate target consistency (1-100)
        if (request.TargetConsistency is < 1 or > 100)
            return Results.BadRequest(new { error = "Target consistency must be between 1 and 100" });

        // Validate end date
        if (!DateOnly.TryParse(request.EndDate, out var endDate))
            return Results.BadRequest(new { error = $"Invalid end date format: {request.EndDate}" });

        var timezoneHeader = ctx.Request.Headers["X-Timezone"].FirstOrDefault();
        TimeZoneInfo promiseTz = TimeZoneInfo.Utc;
        if (!string.IsNullOrWhiteSpace(timezoneHeader))
        {
            try
            {
                promiseTz = TimeZoneInfo.FindSystemTimeZoneById(timezoneHeader);
            }
            catch (TimeZoneNotFoundException)
            {
            }
        }
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, promiseTz));
        if (endDate <= today)
            return Results.BadRequest(new { error = "End date must be in the future" });

        // Validate private note length
        var privateNote = request.PrivateNote?.Trim();
        if (privateNote is not null && privateNote.Length > 512)
            return Results.BadRequest(new { error = "Private note must not exceed 512 characters" });

        // Check for existing active promise on this habit
        var existingActive = await db.Promises
            .AnyAsync(p => p.UserId == userId && p.HabitId == habitId && p.Status == PromiseStatus.Active);
        if (existingActive)
            return Results.Conflict(new { error = "An active promise already exists for this habit" });

        var promise = new Promise
        {
            UserId = userId,
            HabitId = habitId,
            TargetConsistency = request.TargetConsistency,
            EndDate = endDate,
            PrivateNote = string.IsNullOrWhiteSpace(privateNote) ? null : privateNote,
            IsPublicOnFlame = request.IsPublicOnFlame ?? false,
            Status = PromiseStatus.Active
        };

        try
        {
            db.Promises.Add(promise);
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Results.Conflict(new { error = "An active promise already exists for this habit" });
        }

        return Results.Created($"/habits/{habitId}/promise", MapPromiseToResponse(promise, null));
    }

    private static async Task<IResult> GetPromise(Guid habitId, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var timezoneHeader = ctx.Request.Headers["X-Timezone"].FirstOrDefault();

        // Include past promises for history
        var includeHistory = ctx.Request.Query["history"].FirstOrDefault() == "true";

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId && h.ArchivedAt == null);
        if (habit is null)
            return Results.NotFound();

        // Resolve timezone for consistency calculation
        TimeZoneInfo tz = TimeZoneInfo.Utc;
        if (!string.IsNullOrWhiteSpace(timezoneHeader))
        {
            try
            {
                tz = TimeZoneInfo.FindSystemTimeZoneById(timezoneHeader);
            }
            catch (TimeZoneNotFoundException)
            {
                // fall back to UTC
            }
        }

        // Check if active promise has expired and resolve it
        var activePromise = await db.Promises
            .FirstOrDefaultAsync(p => p.UserId == userId && p.HabitId == habitId && p.Status == PromiseStatus.Active);

        if (activePromise is not null)
        {
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));

            if (activePromise.EndDate < today)
            {
                // Promise period has ended — resolve it
                var completionData = await db.Completions
                    .Where(c => c.HabitId == habitId)
                    .Select(c => new { c.LocalDate, c.CompletionKind })
                    .ToListAsync();

                var completionMap = completionData.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
                // Promise evaluation uses the 60-day rolling window consistency (same as the flame),
                // not a promise-period-specific calculation. This matches the bead spec: "Promise progress
                // should be derived from the same underlying consistency contract the flame already uses."
                var consistency = ConsistencyCalculator.Calculate(habit, completionMap, tz);

                activePromise.Status = consistency >= activePromise.TargetConsistency
                    ? PromiseStatus.Kept
                    : PromiseStatus.EndedBelow;
                activePromise.ResolvedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }
        }

        // Re-fetch active promise (may have been resolved above)
        activePromise = await db.Promises
            .FirstOrDefaultAsync(p => p.UserId == userId && p.HabitId == habitId && p.Status == PromiseStatus.Active);

        // Calculate current consistency for on-track status
        double? currentConsistency = null;
        if (activePromise is not null)
        {
            var completionData = await db.Completions
                .Where(c => c.HabitId == habitId)
                .Select(c => new { c.LocalDate, c.CompletionKind })
                .ToListAsync();

            var completionMap = completionData.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
            currentConsistency = ConsistencyCalculator.Calculate(habit, completionMap, tz);
        }

        if (!includeHistory)
        {
            if (activePromise is null)
                return Results.Ok(new { active = (object?)null, history = Array.Empty<object>() });

            return Results.Ok(new
            {
                active = MapPromiseToResponse(activePromise, currentConsistency),
                history = Array.Empty<object>()
            });
        }

        // Include historical (resolved) promises
        var pastPromises = await db.Promises
            .Where(p => p.UserId == userId && p.HabitId == habitId && p.Status != PromiseStatus.Active)
            .OrderByDescending(p => p.ResolvedAt)
            .ToListAsync();

        return Results.Ok(new
        {
            active = activePromise is not null ? MapPromiseToResponse(activePromise, currentConsistency) : null,
            history = pastPromises.Select(p => MapPromiseToResponse(p, null))
        });
    }

    private static async Task<IResult> CancelPromise(Guid habitId, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var promise = await db.Promises
            .FirstOrDefaultAsync(p => p.UserId == userId && p.HabitId == habitId && p.Status == PromiseStatus.Active);

        if (promise is null)
            return Results.NotFound();

        promise.Status = PromiseStatus.Cancelled;
        promise.ResolvedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();

        return Results.NoContent();
    }

    private static async Task<IResult> ToggleVisibility(Guid habitId, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<UpdatePromiseVisibilityRequest>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null)
            return Results.BadRequest(new { error = "Request body is required" });

        // Verify the habit exists and isn't archived before toggling visibility
        var habitExists = await db.Habits.AnyAsync(h => h.Id == habitId && h.UserId == userId && h.ArchivedAt == null);
        if (!habitExists)
            return Results.NotFound();

        var promise = await db.Promises
            .FirstOrDefaultAsync(p => p.UserId == userId && p.HabitId == habitId && p.Status == PromiseStatus.Active);

        if (promise is null)
            return Results.NotFound();

        promise.IsPublicOnFlame = request.IsPublicOnFlame;
        await db.SaveChangesAsync();

        return Results.Ok(new { isPublicOnFlame = promise.IsPublicOnFlame });
    }

    // --- Response mapping ---

    internal static object MapPromiseToResponse(Promise promise, double? currentConsistency) => new
    {
        id = promise.Id,
        habitId = promise.HabitId,
        targetConsistency = promise.TargetConsistency,
        endDate = promise.EndDate.ToString("yyyy-MM-dd"),
        privateNote = promise.PrivateNote,
        status = promise.Status.ToString().ToLowerInvariant(),
        onTrack = promise.Status == PromiseStatus.Active && currentConsistency.HasValue
            ? currentConsistency.Value >= promise.TargetConsistency
            : (bool?)null,
        currentConsistency = currentConsistency,
        isPublicOnFlame = promise.IsPublicOnFlame,
        statement = GeneratePromiseStatement(promise),
        createdAt = promise.CreatedAt,
        resolvedAt = promise.ResolvedAt
    };

    // Public-safe promise response — excludes PrivateNote and internal fields.
    // Used on public flame and witness surfaces.
    internal static object MapPromiseToPublicResponse(Promise promise, double? currentConsistency) => new
    {
        targetConsistency = promise.TargetConsistency,
        endDate = promise.EndDate.ToString("yyyy-MM-dd"),
        statement = GeneratePromiseStatement(promise),
        onTrack = promise.Status == PromiseStatus.Active && currentConsistency.HasValue
            ? currentConsistency.Value >= promise.TargetConsistency
            : (bool?)null,
    };

    private static string GeneratePromiseStatement(Promise promise)
    {
        var target = (int)promise.TargetConsistency;
        var endDateStr = promise.EndDate.ToString("MMMM d");
        return $"Keeping above {target}% through {endDateStr}";
    }
}

// --- Request DTOs ---

internal record CreatePromiseRequest(double TargetConsistency, string EndDate, string? PrivateNote, bool? IsPublicOnFlame);
internal record UpdatePromiseVisibilityRequest(bool IsPublicOnFlame);
