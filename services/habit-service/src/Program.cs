using System.Security;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
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

builder.AddObservability("habit-service");
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

builder.Services.AddHttpClient("SocialService", client =>
{
    var socialUrl = builder.Configuration["Services:SocialServiceUrl"] ?? "http://social-service:5003";
    client.BaseAddress = new Uri(socialUrl);
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

    CreateHabitRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<CreateHabitRequest>(jsonOptions);
    }
    catch (Exception ex) when (ex is JsonException or InvalidOperationException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
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

    UpdateHabitRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<UpdateHabitRequest>(jsonOptions);
    }
    catch (Exception ex) when (ex is JsonException or InvalidOperationException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
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
});

app.MapDelete("/habits/{id:guid}", async (Guid id, HttpContext ctx, HabitDbContext db, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId);
    if (habit is null)
        return Results.NotFound();

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
});

app.MapPost("/habits/{id:guid}/complete", async (Guid id, HttpContext ctx, HabitDbContext db, NatsEventPublisher nats, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var habit = await db.Habits.FirstOrDefaultAsync(h => h.Id == id && h.UserId == userId && h.ArchivedAt == null);
    if (habit is null)
        return Results.NotFound();

    CompleteHabitRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<CompleteHabitRequest>(jsonOptions);
    }
    catch (Exception ex) when (ex is JsonException or InvalidOperationException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
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
    var completionKind = request.CompletionKind ?? Winzy.Contracts.CompletionKind.Full;
    if (completionKind is not (Winzy.Contracts.CompletionKind.Full or Winzy.Contracts.CompletionKind.Minimum))
        return Results.BadRequest(new { error = "Invalid completionKind. Must be 'full' or 'minimum'" });

    // Validate: can't log minimum if habit has no MinimumDescription configured
    if (completionKind == Winzy.Contracts.CompletionKind.Minimum && string.IsNullOrWhiteSpace(habit.MinimumDescription))
        return Results.BadRequest(new { error = "Cannot log minimum completion for a habit without a configured minimum description" });

    // Check for duplicate completion
    var exists = await db.Completions.AnyAsync(c => c.HabitId == id && c.LocalDate == localDate);
    if (exists)
        return Results.Conflict(new { error = "Habit already completed for this date" });

    var completion = new Completion
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

app.MapPut("/habits/{id:guid}/completions/{date}", async (Guid id, string date, HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    if (!DateOnly.TryParse(date, out var localDate))
        return Results.BadRequest(new { error = $"Invalid date format: {date}" });

    UpdateCompletionRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<UpdateCompletionRequest>(jsonOptions);
    }
    catch (Exception ex) when (ex is JsonException or InvalidOperationException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
    if (request is null)
        return Results.BadRequest(new { error = "Request body is required" });

    if (request.CompletionKind is not (Winzy.Contracts.CompletionKind.Full or Winzy.Contracts.CompletionKind.Minimum))
        return Results.BadRequest(new { error = "Invalid completionKind. Must be 'full' or 'minimum'" });

    var completion = await db.Completions
        .Include(c => c.Habit)
        .FirstOrDefaultAsync(c => c.HabitId == id && c.LocalDate == localDate && c.UserId == userId);

    if (completion is null)
        return Results.NotFound();

    // Validate: can't change to minimum if habit has no MinimumDescription configured
    if (request.CompletionKind == Winzy.Contracts.CompletionKind.Minimum
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
});

// --- Completions by date (authenticated) ---

app.MapGet("/habits/completions", async (HttpContext ctx, HabitDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
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
});

// --- Internal export endpoint (service-to-service, per export-contracts.md) ---

app.MapGet("/habits/internal/export/{userId:guid}", async (Guid userId, HabitDbContext db) =>
{
    var habits = await db.Habits
        .Where(h => h.UserId == userId)
        .Include(h => h.Completions)
        .OrderBy(h => h.CreatedAt)
        .ToListAsync();

    if (habits.Count == 0)
    {
        return Results.NotFound();
    }

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
});

// --- Internal endpoint (service-to-service, no auth check) ---
// Share-surface timezone contract: uses UTC — must match /habits/public/{username} and flame.svg.

app.MapGet("/habits/user/{userId:guid}", async (Guid userId, HabitDbContext db) =>
{
    var habits = await db.Habits
        .Where(h => h.UserId == userId && h.ArchivedAt == null)
        .Include(h => h.Completions)
        .OrderBy(h => h.CreatedAt)
        .ToListAsync();

    return Results.Ok(habits.Select(h =>
    {
        var completionMap = h.Completions.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
        var consistency = ConsistencyCalculator.Calculate(h, completionMap, TimeZoneInfo.Utc);
        var flameLevel = ConsistencyCalculator.GetFlameLevel(consistency);

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
            completions = h.Completions.Select(c => new
            {
                localDate = c.LocalDate.ToString("yyyy-MM-dd"),
                completedAt = c.CompletedAt,
                completionKind = c.CompletionKind.ToString().ToLowerInvariant()
            })
        };
    }));
});

// --- Internal endpoint: range-specific consistency (service-to-service, no auth check) ---

app.MapGet("/habits/internal/{habitId:guid}/consistency", async (Guid habitId, HttpContext ctx, HabitDbContext db) =>
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
        .Select(c => c.LocalDate)
        .ToListAsync();

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
        ? ConsistencyCalculator.CalculateForDateRange(habit, [.. completionData], from, to, tz)
        : ConsistencyCalculator.CalculateForDateRange(habit, [.. completionData], from, to);

    return Results.Ok(new
    {
        habitId,
        from = from.ToString("yyyy-MM-dd"),
        to = to.ToString("yyyy-MM-dd"),
        consistency
    });
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
    HashSet<Guid> visibleHabitIds;
    HashSet<Guid> excludedHabitIds;
    bool defaultIsPublic;
    bool socialDegraded = false;
    try
    {
        var socialClient = httpClientFactory.CreateClient("SocialService");
        using var visResponse = await socialClient.GetAsync(
            $"/social/internal/visible-habits/{resolvedUserId}?viewer=public");
        if (!visResponse.IsSuccessStatusCode)
        {
            logger.LogWarning("Social service returned {StatusCode} for visibility check, failing safe", visResponse.StatusCode);
            visibleHabitIds = [];
            excludedHabitIds = [];
            defaultIsPublic = false;
            socialDegraded = true;
        }
        else
        {
            var visData = await visResponse.Content.ReadFromJsonAsync<VisibilityResponse>();
            visibleHabitIds = visData?.HabitIds?.ToHashSet() ?? [];
            excludedHabitIds = visData?.ExcludedHabitIds?.ToHashSet() ?? [];
            defaultIsPublic = string.Equals(visData?.DefaultVisibility, "public", StringComparison.OrdinalIgnoreCase);
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
    {
        logger.LogWarning(ex, "Failed to check visibility via social service for user {UserId}, failing safe", resolvedUserId);
        visibleHabitIds = [];
        excludedHabitIds = [];
        defaultIsPublic = false;
        socialDegraded = true;
    }

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

    var result = filteredHabits.Select(h =>
    {
        var completionMap = h.Completions.ToDictionary(c => c.LocalDate, c => c.CompletionKind);
        var consistency = ConsistencyCalculator.Calculate(h, completionMap, TimeZoneInfo.Utc);
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

    return Results.Ok(new { username, habits = result, degraded = socialDegraded });
});

// --- SVG flame badge endpoint (embeddable, no auth) ---

app.MapGet("/habits/public/{username}/flame.svg", async (string username, HabitDbContext db, HttpContext ctx, IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
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
    HashSet<Guid> visibleHabitIds;
    HashSet<Guid> excludedHabitIds;
    bool defaultIsPublic;
    try
    {
        var socialClient = httpClientFactory.CreateClient("SocialService");
        using var visResponse = await socialClient.GetAsync(
            $"/social/internal/visible-habits/{resolvedUserId}?viewer=public");
        if (!visResponse.IsSuccessStatusCode)
        {
            logger.LogWarning("Social service returned {StatusCode} for badge visibility check, failing safe", visResponse.StatusCode);
            visibleHabitIds = [];
            excludedHabitIds = [];
            defaultIsPublic = false;
        }
        else
        {
            var visData = await visResponse.Content.ReadFromJsonAsync<VisibilityResponse>();
            visibleHabitIds = visData?.HabitIds?.ToHashSet() ?? [];
            excludedHabitIds = visData?.ExcludedHabitIds?.ToHashSet() ?? [];
            defaultIsPublic = string.Equals(visData?.DefaultVisibility, "public", StringComparison.OrdinalIgnoreCase);
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
    {
        logger.LogWarning(ex, "Failed to check badge visibility via social service for user {UserId}, failing safe", resolvedUserId);
        visibleHabitIds = [];
        excludedHabitIds = [];
        defaultIsPublic = false;
    }

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
    minimumDescription = habit.MinimumDescription,
    createdAt = habit.CreatedAt,
    archivedAt = habit.ArchivedAt
};

// --- Request DTOs ---

internal record CreateHabitRequest(string Name, string? Icon, string? Color, FrequencyType Frequency, List<DayOfWeek>? CustomDays, string? MinimumDescription);
internal record UpdateHabitRequest(string? Name, string? Icon, string? Color, FrequencyType? Frequency, List<DayOfWeek>? CustomDays, string? MinimumDescription, bool? ClearMinimumDescription);
internal record CompleteHabitRequest(string? Date, string Timezone, Winzy.Contracts.CompletionKind? CompletionKind);
internal record UpdateCompletionRequest(Winzy.Contracts.CompletionKind CompletionKind);
internal record ResolvedUserResponse(Guid UserId);
internal record VisibilityResponse(List<Guid>? HabitIds, List<Guid>? ExcludedHabitIds, string? DefaultVisibility);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
