using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Winzy.Common.Health;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.HabitService.Data;
using Winzy.HabitService.Entities;
using Winzy.HabitService.Services;
using Winzy.HabitService.Subscribers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<HabitDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<HabitDbContext>()
    .AddNatsHealthCheck();

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

// --- DTOs ---

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
};

// --- Authenticated endpoints (user_id from X-User-Id header) ---

app.MapPost("/habits", async (HttpContext ctx, HabitDbContext db, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var request = await ctx.Request.ReadFromJsonAsync<CreateHabitRequest>(jsonOptions);
    if (request is null || string.IsNullOrWhiteSpace(request.Name))
        return Results.BadRequest(new { error = "Name is required" });
    if (request.Name.Trim().Length > 256)
        return Results.BadRequest(new { error = "Name must not exceed 256 characters" });

    if (request.Frequency == FrequencyType.Custom && (request.CustomDays is null || request.CustomDays.Count == 0))
        return Results.BadRequest(new { error = "CustomDays required for Custom frequency" });

    var habit = new Habit
    {
        UserId = userId,
        Name = request.Name.Trim(),
        Icon = request.Icon?.Trim(),
        Color = request.Color?.Trim(),
        Frequency = request.Frequency,
        CustomDays = request.Frequency == FrequencyType.Custom ? request.CustomDays : null
    };

    db.Habits.Add(habit);
    await db.SaveChangesAsync();

    try
    {
        await nats.PublishAsync(Subjects.HabitCreated, new HabitCreatedEvent(userId, habit.Id, habit.Name));
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Failed to publish habit.created event for habit {HabitId}", habit.Id);
    }

    return Results.Created($"/habits/{habit.Id}", MapToResponse(habit));
});

app.MapGet("/habits", async (HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var habits = await db.Habits
        .Where(h => h.UserId == userId && h.ArchivedAt == null)
        .OrderBy(h => h.CreatedAt)
        .ToListAsync();

    return Results.Ok(habits.Select(MapToResponse));
});

app.MapGet("/habits/{id:guid}", async (Guid id, HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
    if (habit is null)
        return Results.NotFound();

    return Results.Ok(MapToResponse(habit));
});

app.MapPut("/habits/{id:guid}", async (Guid id, HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
    if (habit is null)
        return Results.NotFound();

    var request = await ctx.Request.ReadFromJsonAsync<UpdateHabitRequest>(jsonOptions);
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
        if (request.Frequency.Value == FrequencyType.Custom && (request.CustomDays is null || request.CustomDays.Count == 0))
            return Results.BadRequest(new { error = "CustomDays required for Custom frequency" });
        habit.Frequency = request.Frequency.Value;
        habit.CustomDays = request.Frequency.Value == FrequencyType.Custom ? request.CustomDays : null;
    }
    else if (request.CustomDays is not null && habit.Frequency == FrequencyType.Custom)
    {
        if (request.CustomDays.Count == 0)
            return Results.BadRequest(new { error = "CustomDays cannot be empty for Custom frequency" });
        habit.CustomDays = request.CustomDays;
    }

    await db.SaveChangesAsync();

    return Results.Ok(MapToResponse(habit));
});

app.MapDelete("/habits/{id:guid}", async (Guid id, HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId);
    if (habit is null)
        return Results.NotFound();

    // Soft-delete via archiving
    habit.ArchivedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    return Results.NoContent();
});

app.MapPost("/habits/{id:guid}/complete", async (Guid id, HttpContext ctx, HabitDbContext db, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
    if (habit is null)
        return Results.NotFound();

    var request = await ctx.Request.ReadFromJsonAsync<CompleteHabitRequest>(jsonOptions);
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

    // Validate date range: not in the future, not more than 60 days in the past
    var userToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));
    if (localDate > userToday)
        return Results.BadRequest(new { error = "Cannot log completions in the future" });
    if (localDate < userToday.AddDays(-ConsistencyCalculator.WindowDays))
        return Results.BadRequest(new { error = $"Cannot log completions more than {ConsistencyCalculator.WindowDays} days in the past" });

    // Check for duplicate completion
    var exists = await db.Completions.AnyAsync(c => c.HabitId == id && c.LocalDate == localDate);
    if (exists)
        return Results.Conflict(new { error = "Habit already completed for this date" });

    var completion = new Completion
    {
        HabitId = id,
        UserId = userId,
        CompletedAt = DateTimeOffset.UtcNow,
        LocalDate = localDate
    };

    db.Completions.Add(completion);
    await db.SaveChangesAsync();

    // Calculate consistency for the event
    var completedDates = await db.Completions
        .Where(c => c.HabitId == id)
        .Select(c => c.LocalDate)
        .ToListAsync();

    var consistency = ConsistencyCalculator.Calculate(habit, [.. completedDates], tz);

    try
    {
        await nats.PublishAsync(Subjects.HabitCompleted,
            new HabitCompletedEvent(userId, id, localDate.ToDateTime(TimeOnly.MinValue), consistency));
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Failed to publish habit.completed event for habit {HabitId}", id);
    }

    return Results.Created($"/habits/{id}/completions/{localDate:yyyy-MM-dd}", new
    {
        id = completion.Id,
        habitId = id,
        localDate = localDate.ToString("yyyy-MM-dd"),
        completedAt = completion.CompletedAt,
        consistency
    });
});

app.MapDelete("/habits/{id:guid}/completions/{date}", async (Guid id, string date, HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
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
});

app.MapGet("/habits/{id:guid}/stats", async (Guid id, HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
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

    var completedDates = await db.Completions
        .Where(c => c.HabitId == id)
        .Select(c => c.LocalDate)
        .ToListAsync();

    var consistency = ConsistencyCalculator.Calculate(habit, [.. completedDates], tz);
    var flameLevel = ConsistencyCalculator.GetFlameLevel(consistency);
    var totalCompletions = completedDates.Count;

    var userNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
    var today = DateOnly.FromDateTime(userNow);
    var windowStart = today.AddDays(-(ConsistencyCalculator.WindowDays - 1));

    var completionsInWindow = completedDates.Count(d => d >= windowStart && d <= today);

    return Results.Ok(new
    {
        habitId = id,
        consistency,
        flameLevel = flameLevel.ToString().ToLowerInvariant(),
        totalCompletions,
        completionsInWindow,
        windowDays = ConsistencyCalculator.WindowDays,
        windowStart = windowStart.ToString("yyyy-MM-dd"),
        today = today.ToString("yyyy-MM-dd")
    });
});

// --- Internal endpoint (service-to-service, no auth check) ---

app.MapGet("/habits/user/{userId:guid}", async (Guid userId, HabitDbContext db) =>
{
    var habits = await db.Habits
        .Where(h => h.UserId == userId && h.ArchivedAt == null)
        .Include(h => h.Completions)
        .OrderBy(h => h.CreatedAt)
        .ToListAsync();

    return Results.Ok(habits.Select(h => new
    {
        id = h.Id,
        name = h.Name,
        icon = h.Icon,
        color = h.Color,
        frequency = h.Frequency.ToString().ToLowerInvariant(),
        createdAt = h.CreatedAt,
        completions = h.Completions.Select(c => new
        {
            localDate = c.LocalDate.ToString("yyyy-MM-dd"),
            completedAt = c.CompletedAt
        })
    }));
});

// --- Public endpoint (no auth, used for shareable flame profiles) ---

app.MapGet("/habits/public/{username}", async (string username, HabitDbContext db, HttpContext ctx, IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
{
    // Resolve username -> userId via the auth service (service-to-service call)
    Guid resolvedUserId;
    try
    {
        var authClient = httpClientFactory.CreateClient("AuthService");
        using var resolveResponse = await authClient.GetAsync($"/auth/internal/resolve/{Uri.EscapeDataString(username)}");
        if (!resolveResponse.IsSuccessStatusCode)
            return Results.NotFound();

        var resolved = await resolveResponse.Content.ReadFromJsonAsync<ResolvedUserResponse>();
        if (resolved is null)
            return Results.NotFound();

        resolvedUserId = resolved.UserId;
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
        logger.LogWarning(ex, "Failed to resolve username {Username} via auth service", username);
        return Results.NotFound();
    }

    var timezoneHeader = ctx.Request.Headers["X-Timezone"].FirstOrDefault();
    TimeZoneInfo tz;
    try
    {
        tz = !string.IsNullOrWhiteSpace(timezoneHeader)
            ? TimeZoneInfo.FindSystemTimeZoneById(timezoneHeader)
            : TimeZoneInfo.Utc;
    }
    catch (TimeZoneNotFoundException)
    {
        tz = TimeZoneInfo.Utc;
    }

    var habits = await db.Habits
        .Where(h => h.UserId == resolvedUserId && h.ArchivedAt == null)
        .Include(h => h.Completions)
        .OrderBy(h => h.CreatedAt)
        .ToListAsync();

    var result = habits.Select(h =>
    {
        var completedDates = h.Completions.Select(c => c.LocalDate).ToHashSet();
        var consistency = ConsistencyCalculator.Calculate(h, completedDates, tz);
        var flameLevel = ConsistencyCalculator.GetFlameLevel(consistency);

        return new
        {
            id = h.Id,
            name = h.Name,
            icon = h.Icon,
            color = h.Color,
            consistency,
            flameLevel = flameLevel.ToString().ToLowerInvariant()
        };
    });

    return Results.Ok(new { username, habits = result });
});

app.Run();

// --- Helper methods ---

static bool TryGetUserId(HttpContext ctx, out Guid userId)
{
    userId = Guid.Empty;
    var header = ctx.Request.Headers["X-User-Id"].FirstOrDefault();
    return header is not null && Guid.TryParse(header, out userId);
}

static object MapToResponse(Habit habit) => new
{
    id = habit.Id,
    name = habit.Name,
    icon = habit.Icon,
    color = habit.Color,
    frequency = habit.Frequency.ToString().ToLowerInvariant(),
    customDays = habit.CustomDays,
    createdAt = habit.CreatedAt,
    archivedAt = habit.ArchivedAt
};

// --- Request DTOs ---

internal record CreateHabitRequest(string Name, string? Icon, string? Color, FrequencyType Frequency, List<DayOfWeek>? CustomDays);
internal record UpdateHabitRequest(string? Name, string? Icon, string? Color, FrequencyType? Frequency, List<DayOfWeek>? CustomDays);
internal record CompleteHabitRequest(string? Date, string Timezone);
internal record ResolvedUserResponse(Guid UserId);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
