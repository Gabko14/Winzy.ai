using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
using Winzy.Common.Http;
using Winzy.Common.Json;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.HabitService.Data;
using Winzy.HabitService.Entities;

namespace Winzy.HabitService.Endpoints;

public static class HabitEndpoints
{
    public static void MapHabitEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/habits", CreateHabit);
        endpoints.MapGet("/habits", ListHabits);
        endpoints.MapGet("/habits/{id:guid}", GetHabit);
        endpoints.MapPut("/habits/{id:guid}", UpdateHabit);
        endpoints.MapDelete("/habits/{id:guid}", DeleteHabit);
    }

    private static async Task<IResult> CreateHabit(
        HttpContext ctx, HabitDbContext db, NatsEventPublisher nats, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var (request, error) = await ctx.Request.TryReadBodyAsync<CreateHabitRequest>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null || string.IsNullOrWhiteSpace(request.Name))
            return Results.BadRequest(new { error = "Name is required" });
        if (request.Name.Trim().Length > 256)
            return Results.BadRequest(new { error = "Name must not exceed 256 characters" });

        if ((request.Frequency is FrequencyType.Custom or FrequencyType.Weekly)
            && (request.CustomDays is null || request.CustomDays.Count == 0))
            return Results.BadRequest(new { error = "CustomDays required for Weekly and Custom frequency" });

        var minimumDesc = request.MinimumDescription?.Trim();
        if (minimumDesc is not null && minimumDesc.Length > 512)
            return Results.BadRequest(new { error = "MinimumDescription must not exceed 512 characters" });

        var habit = new Habit
        {
            UserId = userId,
            Name = request.Name.Trim(),
            Icon = request.Icon?.Trim(),
            Color = request.Color?.Trim(),
            Frequency = request.Frequency,
            CustomDays = request.Frequency is FrequencyType.Weekly or FrequencyType.Custom ? request.CustomDays : null,
            MinimumDescription = string.IsNullOrWhiteSpace(minimumDesc) ? null : minimumDesc
        };

        db.Habits.Add(habit);
        await db.SaveChangesAsync();

        try
        {
            await nats.PublishAsync(Subjects.HabitCreated, new HabitCreatedEvent(userId, habit.Id, habit.Name));
        }
        catch (Exception ex) when (ex is NatsException or OperationCanceledException)
        {
            logger.LogWarning(ex, "Failed to publish habit.created event for habit {HabitId}", habit.Id);
        }

        return Results.Created($"/habits/{habit.Id}", MapToResponse(habit));
    }

    private static async Task<IResult> ListHabits(HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var habits = await db.Habits
            .Where(h => h.UserId == userId && h.ArchivedAt == null)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync();

        return Results.Ok(habits.Select(MapToResponse));
    }

    private static async Task<IResult> GetHabit(Guid id, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
        if (habit is null)
            return Results.NotFound();

        return Results.Ok(MapToResponse(habit));
    }

    private static async Task<IResult> UpdateHabit(Guid id, HttpContext ctx, HabitDbContext db)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
        if (habit is null)
            return Results.NotFound();

        var (request, error) = await ctx.Request.TryReadBodyAsync<UpdateHabitRequest>(JsonDefaults.CamelCase);
        if (error is not null)
            return error;
        if (request is null)
            return Results.BadRequest(new { error = "Request body is required" });

        if (request.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest(new { error = "Name is required" });
            if (request.Name.Trim().Length > 256)
                return Results.BadRequest(new { error = "Name must not exceed 256 characters" });
            habit.Name = request.Name.Trim();
        }
        if (request.Icon is not null)
            habit.Icon = request.Icon.Trim();
        if (request.Color is not null)
            habit.Color = request.Color.Trim();
        if (request.Frequency.HasValue)
        {
            if ((request.Frequency.Value is FrequencyType.Custom or FrequencyType.Weekly)
                && (request.CustomDays is null || request.CustomDays.Count == 0))
                return Results.BadRequest(new { error = "CustomDays required for Weekly and Custom frequency" });
            habit.Frequency = request.Frequency.Value;
            habit.CustomDays = request.Frequency.Value is FrequencyType.Weekly or FrequencyType.Custom ? request.CustomDays : null;
        }
        else if (request.CustomDays is not null && (habit.Frequency is FrequencyType.Custom or FrequencyType.Weekly))
        {
            if (request.CustomDays.Count == 0)
                return Results.BadRequest(new { error = "CustomDays cannot be empty for Weekly and Custom frequency" });
            habit.CustomDays = request.CustomDays;
        }

        // Handle MinimumDescription: explicit null clearing via ClearMinimumDescription flag
        if (request.ClearMinimumDescription == true)
        {
            habit.MinimumDescription = null;
        }
        else if (request.MinimumDescription is not null)
        {
            var minDesc = request.MinimumDescription.Trim();
            if (minDesc.Length > 512)
                return Results.BadRequest(new { error = "MinimumDescription must not exceed 512 characters" });
            habit.MinimumDescription = string.IsNullOrWhiteSpace(minDesc) ? null : minDesc;
        }

        await db.SaveChangesAsync();

        return Results.Ok(MapToResponse(habit));
    }

    private static async Task<IResult> DeleteHabit(
        Guid id, HttpContext ctx, HabitDbContext db, NatsEventPublisher nats, ILogger<Program> logger)
    {
        if (!ctx.TryGetUserId(out var userId))
            return Results.BadRequest(new { error = "Missing X-User-Id header" });

        var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId);
        if (habit is null)
            return Results.NotFound();

        // Cancel any active promise before archiving
        var activePromise = await db.Promises
            .FirstOrDefaultAsync(p => p.HabitId == id && p.UserId == userId && p.Status == PromiseStatus.Active);
        if (activePromise is not null)
        {
            activePromise.Status = PromiseStatus.Cancelled;
            activePromise.ResolvedAt = DateTimeOffset.UtcNow;
        }

        // Soft-delete via archiving
        habit.ArchivedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();

        try
        {
            await nats.PublishAsync(Subjects.HabitArchived, new HabitArchivedEvent(userId, id));
        }
        catch (Exception ex) when (ex is NatsException or OperationCanceledException)
        {
            logger.LogWarning(ex, "Failed to publish habit.archived event for habit {HabitId}", id);
        }

        return Results.NoContent();
    }

    internal static object MapToResponse(Habit habit) => new
    {
        id = habit.Id,
        name = habit.Name,
        icon = habit.Icon,
        color = habit.Color,
        frequency = habit.Frequency.ToString().ToLowerInvariant(),
        customDays = habit.CustomDays,
        minimumDescription = habit.MinimumDescription,
        createdAt = habit.CreatedAt,
        archivedAt = habit.ArchivedAt
    };
}

// --- Request DTOs ---

internal record CreateHabitRequest(string Name, string? Icon, string? Color, FrequencyType Frequency, List<DayOfWeek>? CustomDays, string? MinimumDescription);
internal record UpdateHabitRequest(string? Name, string? Icon, string? Color, FrequencyType? Frequency, List<DayOfWeek>? CustomDays, string? MinimumDescription, bool? ClearMinimumDescription);
