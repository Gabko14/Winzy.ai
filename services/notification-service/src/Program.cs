using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.Common.Health;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;
using Winzy.NotificationService.Data;
using Winzy.NotificationService.Entities;
using Winzy.NotificationService.Services;
using Winzy.NotificationService.Subscribers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<NotificationDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddSingleton<PushDeliveryService>();
builder.Services.AddHostedService<HabitCompletedSubscriber>();
builder.Services.AddHostedService<FriendRequestSentSubscriber>();
builder.Services.AddHostedService<FriendRequestAcceptedSubscriber>();
builder.Services.AddHostedService<ChallengeCreatedSubscriber>();
builder.Services.AddHostedService<ChallengeCompletedSubscriber>();
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<NotificationDbContext>()
    .AddNatsHealthCheck();

var app = builder.Build();

app.UseObservability();
app.MapOpenApi();
app.MapServiceHealthChecks();

// --- Authenticated endpoints (user_id from X-User-Id header) ---

app.MapGet("/notifications", async (HttpContext ctx, NotificationDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var page = Math.Max(1, int.TryParse(ctx.Request.Query["page"], out var p) ? p : 1);
    var pageSize = Math.Clamp(int.TryParse(ctx.Request.Query["pageSize"], out var ps) ? ps : 20, 1, 100);

    var query = db.Notifications
        .Where(n => n.UserId == userId)
        .OrderByDescending(n => n.CreatedAt);

    var total = await query.CountAsync();

    var notifications = await query
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync();

    return Results.Ok(new
    {
        items = notifications.Select(MapToResponse),
        page,
        pageSize,
        total
    });
});

app.MapPut("/notifications/{id:guid}/read", async (Guid id, HttpContext ctx, NotificationDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var notification = await db.Notifications
        .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId);

    if (notification is null)
        return Results.NotFound();

    if (notification.ReadAt is null)
    {
        notification.ReadAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }

    return Results.Ok(MapToResponse(notification));
});

app.MapPut("/notifications/read-all", async (HttpContext ctx, NotificationDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var now = DateTimeOffset.UtcNow;

    var updated = await db.Notifications
        .Where(n => n.UserId == userId && n.ReadAt == null)
        .ExecuteUpdateAsync(s => s
            .SetProperty(n => n.ReadAt, now)
            .SetProperty(n => n.UpdatedAt, now));

    return Results.Ok(new { markedAsRead = updated });
});

app.MapGet("/notifications/unread-count", async (HttpContext ctx, NotificationDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var count = await db.Notifications
        .CountAsync(n => n.UserId == userId && n.ReadAt == null);

    return Results.Ok(new { unreadCount = count });
});

app.MapPut("/notifications/settings", async (HttpContext ctx, NotificationDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    UpdateSettingsRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<UpdateSettingsRequest>();
    }
    catch (Exception)
    {
        request = null;
    }
    if (request is null)
        return Results.BadRequest(new { error = "Request body is required" });

    var settings = await db.NotificationSettings
        .FirstOrDefaultAsync(s => s.UserId == userId);

    if (settings is null)
    {
        settings = new NotificationSettings { UserId = userId };
        db.NotificationSettings.Add(settings);
    }

    if (request.HabitReminders.HasValue)
        settings.HabitReminders = request.HabitReminders.Value;
    if (request.FriendActivity.HasValue)
        settings.FriendActivity = request.FriendActivity.Value;
    if (request.ChallengeUpdates.HasValue)
        settings.ChallengeUpdates = request.ChallengeUpdates.Value;

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        habitReminders = settings.HabitReminders,
        friendActivity = settings.FriendActivity,
        challengeUpdates = settings.ChallengeUpdates
    });
});

// --- Device token management (push notifications) ---

app.MapPost("/notifications/devices", async (HttpContext ctx, NotificationDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    RegisterDeviceRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<RegisterDeviceRequest>();
    }
    catch (Exception)
    {
        request = null;
    }
    if (request is null)
        return Results.BadRequest(new { error = "Request body is required" });

    if (string.IsNullOrWhiteSpace(request.Platform) || string.IsNullOrWhiteSpace(request.Token))
        return Results.BadRequest(new { error = "Platform and token are required" });

    var validPlatforms = new[] { "web_push", "expo_push" };
    if (!validPlatforms.Contains(request.Platform))
        return Results.BadRequest(new { error = "Platform must be 'web_push' or 'expo_push'" });

    // Upsert: if same device already registered, update the token
    DeviceToken? existing = null;
    if (!string.IsNullOrWhiteSpace(request.DeviceId))
    {
        existing = await db.DeviceTokens
            .FirstOrDefaultAsync(t => t.UserId == userId && t.DeviceId == request.DeviceId);
    }

    if (existing is not null)
    {
        existing.Token = request.Token;
        existing.Platform = request.Platform;
        existing.UpdatedAt = DateTimeOffset.UtcNow;
    }
    else
    {
        db.DeviceTokens.Add(new DeviceToken
        {
            UserId = userId,
            Platform = request.Platform,
            Token = request.Token,
            DeviceId = request.DeviceId
        });
    }

    await db.SaveChangesAsync();
    return Results.Created();
});

app.MapDelete("/notifications/devices", async (HttpContext ctx, NotificationDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    UnregisterDeviceRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<UnregisterDeviceRequest>();
    }
    catch (Exception)
    {
        request = null;
    }
    if (request is null || string.IsNullOrWhiteSpace(request.DeviceId))
        return Results.BadRequest(new { error = "DeviceId is required" });

    var deleted = await db.DeviceTokens
        .Where(t => t.UserId == userId && t.DeviceId == request.DeviceId)
        .ExecuteDeleteAsync();

    return deleted > 0 ? Results.NoContent() : Results.NotFound();
});

// --- Internal export endpoint (service-to-service, per export-contracts.md) ---

app.MapGet("/notifications/internal/export/{userId:guid}", async (Guid userId, NotificationDbContext db) =>
{
    var settings = await db.NotificationSettings
        .FirstOrDefaultAsync(s => s.UserId == userId);

    var hasNotifications = await db.Notifications.AnyAsync(n => n.UserId == userId);

    if (settings is null && !hasNotifications)
        return Results.NotFound();

    var notifications = await db.Notifications
        .Where(n => n.UserId == userId)
        .OrderByDescending(n => n.CreatedAt)
        .ToListAsync();

    return Results.Ok(new
    {
        service = "notification",
        data = new
        {
            settings = new
            {
                habitReminders = settings?.HabitReminders ?? true,
                friendActivity = settings?.FriendActivity ?? true,
                challengeUpdates = settings?.ChallengeUpdates ?? true
            },
            notifications = notifications.Select(MapToResponse)
        }
    });
});

// VAPID public key endpoint — clients need this to subscribe to web push
app.MapGet("/notifications/vapid-public-key", (IConfiguration config) =>
{
    var publicKey = config["WebPush:PublicKey"];
    if (string.IsNullOrEmpty(publicKey))
        return Results.NotFound(new { error = "VAPID public key not configured" });

    return Results.Ok(new { publicKey });
});

app.Run();

// --- Helper methods ---

static bool TryGetUserId(HttpContext ctx, out Guid userId)
{
    userId = Guid.Empty;
    var header = ctx.Request.Headers["X-User-Id"].FirstOrDefault();
    return header is not null && Guid.TryParse(header, out userId);
}

static object MapToResponse(Notification n) => new
{
    id = n.Id,
    type = n.Type.ToString().ToLowerInvariant(),
    data = TryParseJson(n.Data),
    readAt = n.ReadAt,
    createdAt = n.CreatedAt
};

static JsonElement TryParseJson(string json)
{
    try
    { return JsonSerializer.Deserialize<JsonElement>(json); }
    catch { return JsonSerializer.Deserialize<JsonElement>("{}"); }
}

// --- Request DTOs ---

internal record UpdateSettingsRequest(bool? HabitReminders, bool? FriendActivity, bool? ChallengeUpdates);
internal record RegisterDeviceRequest(string Platform, string Token, string? DeviceId);
internal record UnregisterDeviceRequest(string DeviceId);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
