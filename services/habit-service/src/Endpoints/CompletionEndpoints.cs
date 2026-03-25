using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
using Winzy.Common.Http;
using Winzy.Common.Json;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.HabitService.Data;
using Winzy.HabitService.Services;

namespace Winzy.HabitService.Endpoints;

public static class CompletionEndpoints
{
    public static void MapCompletionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/habits/{id:guid}/complete", CompleteHabit);
        endpoints.MapDelete("/habits/{id:guid}/completions/{date}", DeleteCompletion);
        endpoints.MapPut("/habits/{id:guid}/completions/{date}", UpdateCompletion);
        endpoints.MapGet("/habits/{id:guid}/stats", GetStats);
        endpoints.MapGet("/habits/completions", GetCompletionsByDate);
    }

    private static async Task<IResult> CompleteHabit(
        Guid id, HttpContext ctx, HabitDbContext db, NatsEventPublisher nats, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
        if (habit is null)
            return Results.NotFound();

        var (request, error) = await ctx.Request.TryReadBodyAsync<CompleteHabitRequest>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null || string.IsNullOrWhiteSpace(request.Timezone))
            return Results.BadRequest(new { error = "Timezone is required" });

        TimeZoneInfo tz;
        try
        {
            tz = TimeZoneInfo.FindSystemTimeZoneById(request.Timezone);
        }
        catch (TimeZoneNotFoundException)
        {
            return Results.BadRequest(new { error = $"Invalid timezone: {request.Timezone}" });
        }

        DateOnly localDate;
        if (request.Date is not null)
        {
            if (!DateOnly.TryParse(request.Date, out localDate))
                return Results.BadRequest(new { error = $"Invalid date format: {request.Date}" });
        }
        else
        {
            // Resolve "today" in the user's timezone
            var userNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
            localDate = DateOnly.FromDateTime(userNow);
        }

        // Validate date range: not in the future, not before the 60-day rolling window.
        // The window is [today - 59 .. today] (60 days inclusive), so reject anything before windowStart.
        var userToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));
        if (localDate > userToday)
            return Results.BadRequest(new { error = "Cannot log completions in the future" });
        var windowStart = userToday.AddDays(-(ConsistencyCalculator.WindowDays - 1));
        if (localDate < windowStart)
            return Results.BadRequest(new { error = $"Cannot log completions more than {ConsistencyCalculator.WindowDays - 1} days in the past" });

        // Resolve completion kind (default to Full)
        var completionKind = request.CompletionKind ?? CompletionKind.Full;
        if (completionKind is not (CompletionKind.Full or CompletionKind.Minimum))
            return Results.BadRequest(new { error = "Invalid completionKind. Must be 'full' or 'minimum'" });

        // Validate: can't log minimum if habit has no MinimumDescription configured
        if (completionKind == CompletionKind.Minimum && string.IsNullOrWhiteSpace(habit.MinimumDescription))
            return Results.BadRequest(new { error = "Cannot log minimum completion for a habit without a configured minimum description" });

        // Check for duplicate completion
        var exists = await db.Completions.AnyAsync(c => c.HabitId == id && c.LocalDate == localDate);
        if (exists)
            return Results.Conflict(new { error = "Habit already completed for this date" });

        var completion = new Entities.Completion
        {
            HabitId = id,
            UserId = userId,
            CompletedAt = DateTimeOffset.UtcNow,
            LocalDate = localDate,
            CompletionKind = completionKind
        };

        db.Completions.Add(completion);
        await db.SaveChangesAsync();

        // Calculate weighted consistency for the event
        var completionData = await db.Completions
            .Where(c => c.HabitId == id)
            .Select(c => new { c.LocalDate, c.CompletionKind })
            .ToListAsync();

        var completionMap = completionData.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
        var consistency = ConsistencyCalculator.Calculate(habit, completionMap, tz);

        try
        {
            // DisplayName omitted: habit-service doesn't have the user's display name without an
            // extra auth-service call. The notification subscriber falls back to "A friend" when null.
            await nats.PublishAsync(Subjects.HabitCompleted,
                new HabitCompletedEvent(userId, id, localDate.ToDateTime(TimeOnly.MinValue), consistency, request.Timezone, HabitName: habit.Name, CompletionKind: completionKind));
        }
        catch (Exception ex) when (ex is NatsException or OperationCanceledException)
        {
            logger.LogWarning(ex, "Failed to publish habit.completed event for habit {HabitId}", id);
        }

        return Results.Created($"/habits/{id}/completions/{localDate:yyyy-MM-dd}", new
        {
            id = completion.Id,
            habitId = id,
            localDate = localDate.ToString("yyyy-MM-dd"),
            completedAt = completion.CompletedAt,
            completionKind = completionKind.ToString().ToLowerInvariant(),
            consistency
        });
    }

    private static async Task<IResult> DeleteCompletion(Guid id, string date, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        if (!DateOnly.TryParse(date, out var localDate))
            return Results.BadRequest(new { error = $"Invalid date format: {date}" });

        var completion = await db.Completions
            .FirstOrDefaultAsync(c => c.HabitId == id && c.LocalDate == localDate && c.UserId == userId);

        if (completion is null)
            return Results.NotFound();

        db.Completions.Remove(completion);
        await db.SaveChangesAsync();

        return Results.NoContent();
    }

    private static async Task<IResult> UpdateCompletion(Guid id, string date, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        if (!DateOnly.TryParse(date, out var localDate))
            return Results.BadRequest(new { error = $"Invalid date format: {date}" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<UpdateCompletionRequest>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null)
            return Results.BadRequest(new { error = "Request body is required" });

        if (request.CompletionKind is not (CompletionKind.Full or CompletionKind.Minimum))
            return Results.BadRequest(new { error = "Invalid completionKind. Must be 'full' or 'minimum'" });

        var completion = await db.Completions
            .Include(c => c.Habit)
            .FirstOrDefaultAsync(c => c.HabitId == id && c.LocalDate == localDate && c.UserId == userId);

        if (completion is null)
            return Results.NotFound();

        // Validate: can't change to minimum if habit has no MinimumDescription configured
        if (request.CompletionKind == CompletionKind.Minimum
            && string.IsNullOrWhiteSpace(completion.Habit.MinimumDescription))
            return Results.BadRequest(new { error = "Cannot set minimum completion for a habit without a configured minimum description" });

        completion.CompletionKind = request.CompletionKind;
        await db.SaveChangesAsync();

        return Results.Ok(new
        {
            id = completion.Id,
            habitId = id,
            localDate = localDate.ToString("yyyy-MM-dd"),
            completedAt = completion.CompletedAt,
            completionKind = completion.CompletionKind.ToString().ToLowerInvariant()
        });
    }

    private static async Task<IResult> GetStats(Guid id, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var timezoneHeader = ctx.Request.Headers["X-Timezone"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(timezoneHeader))
            return Results.BadRequest(new { error = "X-Timezone header is required" });

        TimeZoneInfo tz;
        try
        {
            tz = TimeZoneInfo.FindSystemTimeZoneById(timezoneHeader);
        }
        catch (TimeZoneNotFoundException)
        {
            return Results.BadRequest(new { error = $"Invalid timezone: {timezoneHeader}" });
        }

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
        if (habit is null)
            return Results.NotFound();

        var completionData = await db.Completions
            .Where(c => c.HabitId == id)
            .Select(c => new { c.LocalDate, c.CompletionKind })
            .ToListAsync();

        var completionMap = completionData.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
        var consistency = ConsistencyCalculator.Calculate(habit, completionMap, tz);
        var flameLevel = ConsistencyCalculator.GetFlameLevel(consistency);
        var totalCompletions = completionData.Count;

        var userNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
        var today = DateOnly.FromDateTime(userNow);
        var windowStart = today.AddDays(-(ConsistencyCalculator.WindowDays - 1));

        var completionsInWindow = completionData.Count(d => d.LocalDate >= windowStart && d.LocalDate <= today);
        var todayCompletion = completionData.FirstOrDefault(d => d.LocalDate == today);

        return Results.Ok(new
        {
            habitId = id,
            consistency,
            flameLevel = flameLevel.ToString().ToLowerInvariant(),
            totalCompletions,
            completionsInWindow,
            completedToday = todayCompletion is not null,
            completedTodayKind = todayCompletion?.CompletionKind.ToString().ToLowerInvariant(),
            windowDays = ConsistencyCalculator.WindowDays,
            windowStart = windowStart.ToString("yyyy-MM-dd"),
            today = today.ToString("yyyy-MM-dd"),
            completedDates = completionData.Select(d => new
            {
                date = d.LocalDate.ToString("yyyy-MM-dd"),
                completionKind = d.CompletionKind.ToString().ToLowerInvariant()
            })
        });
    }

    private static async Task<IResult> GetCompletionsByDate(HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var dateParam = ctx.Request.Query["date"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(dateParam))
            return Results.BadRequest(new { error = "date query parameter is required (YYYY-MM-DD)" });

        if (!DateOnly.TryParse(dateParam, out var date))
            return Results.BadRequest(new { error = $"Invalid date format: {dateParam}" });

        var habits = await db.Habits
            .Where(h => h.UserId == userId && h.ArchivedAt == null)
            .OrderBy(h => h.CreatedAt)
            .Select(h => new
            {
                h.Id,
                h.Name,
                h.Icon,
                h.Color,
                h.MinimumDescription,
                Completion = db.Completions
                    .Where(c => c.HabitId == h.Id && c.LocalDate == date)
                    .Select(c => new { c.CompletionKind })
                    .FirstOrDefault()
            })
            .ToListAsync();

        return Results.Ok(new
        {
            date = date.ToString("yyyy-MM-dd"),
            habits = habits.Select(h => new
            {
                id = h.Id,
                name = h.Name,
                icon = h.Icon,
                color = h.Color,
                minimumDescription = h.MinimumDescription,
                completed = h.Completion is not null,
                completionKind = h.Completion?.CompletionKind.ToString().ToLowerInvariant()
            })
        });
    }
}

// --- Request DTOs ---

internal record CompleteHabitRequest(string? Date, string Timezone, CompletionKind? CompletionKind);
internal record UpdateCompletionRequest(CompletionKind CompletionKind);
