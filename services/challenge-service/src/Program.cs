using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.ChallengeService.Data;
using Winzy.ChallengeService.Entities;
using Winzy.ChallengeService.Services;
using Winzy.ChallengeService.Subscribers;
using Winzy.Common.Health;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;
using Winzy.Contracts;
using Winzy.Contracts.Events;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<ChallengeDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<HabitCompletedSubscriber>();
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<ChallengeDbContext>()
    .AddNatsHealthCheck();

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

var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

// --- POST /challenges ---

app.MapPost("/challenges", async (HttpContext ctx, ChallengeDbContext db, NatsEventPublisher nats,
    IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var request = await ctx.Request.ReadFromJsonAsync<CreateChallengeRequest>(jsonOptions);
    if (request is null)
        return Results.BadRequest(new { error = "Request body is required" });

    if (request.HabitId == Guid.Empty)
        return Results.BadRequest(new { error = "HabitId is required" });
    if (request.RecipientId == Guid.Empty)
        return Results.BadRequest(new { error = "RecipientId is required" });
    if (request.RecipientId == userId)
        return Results.BadRequest(new { error = "Cannot challenge yourself" });
    if (string.IsNullOrWhiteSpace(request.RewardDescription))
        return Results.BadRequest(new { error = "RewardDescription is required" });
    if (request.RewardDescription.Trim().Length > 512)
        return Results.BadRequest(new { error = "RewardDescription must not exceed 512 characters" });
    if (request.TargetValue <= 0 || request.TargetValue > 100)
        return Results.BadRequest(new { error = "TargetValue must be between 1 and 100" });
    if (request.PeriodDays <= 0 || request.PeriodDays > 365)
        return Results.BadRequest(new { error = "PeriodDays must be between 1 and 365" });

    // Validate friendship via Social Service
    bool areFriends;
    try
    {
        var socialClient = httpClientFactory.CreateClient("SocialService");
        using var friendCheck = await socialClient.GetAsync(
            $"/social/internal/friends/{userId}/{request.RecipientId}");
        areFriends = friendCheck.IsSuccessStatusCode;
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
        logger.LogWarning(ex, "Failed to validate friendship between {CreatorId} and {RecipientId}",
            userId, request.RecipientId);
        return Results.StatusCode(503);
    }

    if (!areFriends)
        return Results.BadRequest(new { error = "You can only challenge friends" });

    var challenge = new Challenge
    {
        CreatorId = userId,
        RecipientId = request.RecipientId,
        HabitId = request.HabitId,
        MilestoneType = request.MilestoneType,
        TargetValue = request.TargetValue,
        PeriodDays = request.PeriodDays,
        RewardDescription = request.RewardDescription.Trim(),
        Status = ChallengeStatus.Active,
        EndsAt = DateTimeOffset.UtcNow.AddDays(request.PeriodDays)
    };

    db.Challenges.Add(challenge);
    await db.SaveChangesAsync();

    try
    {
        await nats.PublishAsync(Subjects.ChallengeCreated,
            new ChallengeCreatedEvent(challenge.Id, userId, request.RecipientId, request.HabitId));
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Failed to publish challenge.created event for ChallengeId={ChallengeId}",
            challenge.Id);
    }

    return Results.Created($"/challenges/{challenge.Id}", MapToResponse(challenge));
});

// --- GET /challenges ---

app.MapGet("/challenges", async (HttpContext ctx, ChallengeDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var challenges = await db.Challenges
        .Where(c => c.CreatorId == userId || c.RecipientId == userId)
        .OrderByDescending(c => c.CreatedAt)
        .ToListAsync();

    return Results.Ok(challenges.Select(MapToResponse));
});

// --- GET /challenges/{id} ---

app.MapGet("/challenges/{id:guid}", async (Guid id, HttpContext ctx, ChallengeDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var challenge = await db.Challenges
        .FirstOrDefaultAsync(c => c.Id == id && (c.CreatorId == userId || c.RecipientId == userId));

    if (challenge is null)
        return Results.NotFound();

    return Results.Ok(MapToDetailResponse(challenge));
});

// --- PUT /challenges/{id}/claim ---

app.MapPut("/challenges/{id:guid}/claim", async (Guid id, HttpContext ctx, ChallengeDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var challenge = await db.Challenges
        .FirstOrDefaultAsync(c => c.Id == id && (c.CreatorId == userId || c.RecipientId == userId));

    if (challenge is null)
        return Results.NotFound();

    if (challenge.Status != ChallengeStatus.Completed)
        return Results.BadRequest(new { error = "Only completed challenges can be claimed" });

    challenge.Status = ChallengeStatus.Claimed;
    challenge.ClaimedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    return Results.Ok(MapToResponse(challenge));
});

// --- DELETE /challenges/{id} ---

app.MapDelete("/challenges/{id:guid}", async (Guid id, HttpContext ctx, ChallengeDbContext db) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var challenge = await db.Challenges
        .FirstOrDefaultAsync(c => c.Id == id && c.CreatorId == userId);

    if (challenge is null)
        return Results.NotFound();

    if (challenge.Status is ChallengeStatus.Completed or ChallengeStatus.Claimed)
        return Results.BadRequest(new { error = "Cannot cancel a completed challenge" });

    challenge.Status = ChallengeStatus.Cancelled;
    await db.SaveChangesAsync();

    return Results.NoContent();
});

app.Run();

// --- Helper methods ---

static bool TryGetUserId(HttpContext ctx, out Guid userId)
{
    userId = Guid.Empty;
    var header = ctx.Request.Headers["X-User-Id"].FirstOrDefault();
    return header is not null && Guid.TryParse(header, out userId);
}

static object MapToResponse(Challenge c) => new
{
    id = c.Id,
    habitId = c.HabitId,
    creatorId = c.CreatorId,
    recipientId = c.RecipientId,
    milestoneType = c.MilestoneType.ToString().ToLowerInvariant(),
    targetValue = c.TargetValue,
    periodDays = c.PeriodDays,
    rewardDescription = c.RewardDescription,
    status = c.Status.ToString().ToLowerInvariant(),
    createdAt = c.CreatedAt,
    endsAt = c.EndsAt,
    completedAt = c.CompletedAt,
    claimedAt = c.ClaimedAt
};

static object MapToDetailResponse(Challenge c) => new
{
    id = c.Id,
    habitId = c.HabitId,
    creatorId = c.CreatorId,
    recipientId = c.RecipientId,
    milestoneType = c.MilestoneType.ToString().ToLowerInvariant(),
    targetValue = c.TargetValue,
    periodDays = c.PeriodDays,
    rewardDescription = c.RewardDescription,
    status = c.Status.ToString().ToLowerInvariant(),
    progress = c.CurrentProgress,
    createdAt = c.CreatedAt,
    endsAt = c.EndsAt,
    completedAt = c.CompletedAt,
    claimedAt = c.ClaimedAt
};

// --- Request DTOs ---

internal record CreateChallengeRequest(
    Guid HabitId,
    Guid RecipientId,
    MilestoneType MilestoneType,
    double TargetValue,
    int PeriodDays,
    string RewardDescription);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
