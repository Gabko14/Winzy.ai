using Microsoft.EntityFrameworkCore;
using Winzy.HabitService.Data;
using Winzy.HabitService.Entities;
using Winzy.HabitService.Services;

namespace Winzy.HabitService.Endpoints;

public static class InternalEndpoints
{
    public static void MapInternalEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/habits/internal/export/{userId:guid}", InternalExport);
        endpoints.MapGet("/habits/user/{userId:guid}", InternalGetUserHabits);
        endpoints.MapGet("/habits/internal/{habitId:guid}/consistency", InternalGetConsistency);
    }

    private static async Task<IResult> InternalExport(Guid userId, HabitDbContext db)
    {
        var habits = await db.Habits
            .Where(h => h.UserId == userId)
            .Include(h => h.Completions)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync();

        if (habits.Count == 0)
            return Results.NotFound();

        return Results.Ok(new
        {
            service = "habit",
            data = new
            {
                habits = habits.Select(h => new
                {
                    habitId = h.Id,
                    name = h.Name,
                    icon = h.Icon,
                    color = h.Color,
                    frequency = h.Frequency.ToString(),
                    customDays = h.CustomDays,
                    archivedAt = h.ArchivedAt,
                    createdAt = h.CreatedAt,
                    completions = h.Completions.OrderBy(c => c.LocalDate).Select(c => new
                    {
                        completionId = c.Id,
                        completedAt = c.CompletedAt,
                        localDate = c.LocalDate.ToString("yyyy-MM-dd"),
                        completionKind = c.CompletionKind.ToString().ToLowerInvariant(),
                        note = c.Note
                    })
                })
            }
        });
    }

    // Internal endpoint (service-to-service, no auth check)
    // Share-surface timezone contract: uses UTC — must match /habits/public/{username} and flame.svg.
    private static async Task<IResult> InternalGetUserHabits(Guid userId, HabitDbContext db)
    {
        var habits = await db.Habits
            .Where(h => h.UserId == userId && h.ArchivedAt == null)
            .Include(h => h.Completions)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync();

        // Load active, non-expired promises with IsPublicOnFlame=true for witness/share surfaces.
        // Auto-resolution is lazy (triggered by owner's GET), so filter on EndDate to avoid showing
        // expired promises that haven't been resolved yet.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var habitIds = habits.Select(h => h.Id).ToList();
        var publicPromises = habitIds.Count > 0
            ? await db.Promises
                .Where(p => p.UserId == userId
                    && p.Status == PromiseStatus.Active
                    && p.IsPublicOnFlame
                    && p.EndDate >= today
                    && habitIds.Contains(p.HabitId))
                .ToDictionaryAsync(p => p.HabitId)
            : new Dictionary<Guid, Promise>();

        return Results.Ok(habits.Select(h =>
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
                frequency = h.Frequency.ToString().ToLowerInvariant(),
                createdAt = h.CreatedAt,
                consistency,
                flameLevel = flameLevel.ToString().ToLowerInvariant(),
                promise = promiseData,
                completions = h.Completions.Select(c => new
                {
                    localDate = c.LocalDate.ToString("yyyy-MM-dd"),
                    completedAt = c.CompletedAt,
                    completionKind = c.CompletionKind.ToString().ToLowerInvariant()
                })
            };
        }));
    }

    // Internal endpoint: range-specific consistency (service-to-service, no auth check)
    private static async Task<IResult> InternalGetConsistency(Guid habitId, HttpContext ctx, HabitDbContext db)
    {
        var fromParam = ctx.Request.Query["from"].FirstOrDefault();
        var toParam = ctx.Request.Query["to"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(fromParam) || string.IsNullOrWhiteSpace(toParam))
            return Results.BadRequest(new { error = "from and to query parameters are required (YYYY-MM-DD)" });

        if (!DateOnly.TryParse(fromParam, out var from))
            return Results.BadRequest(new { error = $"Invalid from date: {fromParam}" });

        if (!DateOnly.TryParse(toParam, out var to))
            return Results.BadRequest(new { error = $"Invalid to date: {toParam}" });

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == habitId && h.ArchivedAt == null);
        if (habit is null)
            return Results.NotFound();

        var completionData = await db.Completions
            .Where(c => c.HabitId == habitId && c.LocalDate >= from && c.LocalDate <= to)
            .Select(c => new { c.LocalDate, c.CompletionKind })
            .ToListAsync();

        var completionMap = completionData.ToDictionary(c => c.LocalDate, c => c.CompletionKind);

        // Use timezone-aware creation date clamping when timezone is provided
        var tzParam = ctx.Request.Query["tz"].FirstOrDefault();
        TimeZoneInfo? tz = null;
        if (!string.IsNullOrWhiteSpace(tzParam))
        {
            try
            {
                tz = TimeZoneInfo.FindSystemTimeZoneById(tzParam);
            }
            catch (TimeZoneNotFoundException)
            {
                // fall back to UTC conversion
            }
        }

        var consistency = tz is not null
            ? ConsistencyCalculator.CalculateForDateRange(habit, completionMap, from, to, tz)
            : ConsistencyCalculator.CalculateForDateRange(habit, completionMap, from, to);

        return Results.Ok(new
        {
            habitId,
            from = from.ToString("yyyy-MM-dd"),
            to = to.ToString("yyyy-MM-dd"),
            consistency
        });
    }
}
