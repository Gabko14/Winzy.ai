using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
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

builder.AddObservability("challenge-service");
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

builder.Services.AddHttpClient("HabitService", client =>
{
    var habitUrl = builder.Configuration["Services:HabitServiceUrl"] ?? "http://habit-service:5002";
    client.BaseAddress = new Uri(habitUrl);
    client.Timeout = TimeSpan.FromSeconds(5);
});

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

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
};

// --- POST /challenges ---

app.MapPost("/challenges", async (HttpContext ctx, ChallengeDbContext db, NatsEventPublisher nats,
    IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    CreateChallengeRequest? request;
    try
    {
        request = await ctx.Request.ReadFromJsonAsync<CreateChallengeRequest>(jsonOptions);
    }
    catch (JsonException)
    {
        return Results.BadRequest(new { error = "Invalid JSON in request body" });
    }
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
    if (System.Text.RegularExpressions.Regex.IsMatch(request.RewardDescription, @"<[^>]+>"))
        return Results.BadRequest(new { error = "RewardDescription must not contain HTML tags" });
    if (request.PeriodDays <= 0 || request.PeriodDays > 365)
        return Results.BadRequest(new { error = "PeriodDays must be between 1 and 365" });

    // Milestone-type-specific validation
    if (!Enum.IsDefined(request.MilestoneType))
        return Results.BadRequest(new { error = "Invalid MilestoneType" });

    var targetError = ValidateTargetValue(request);
    if (targetError is not null)
        return Results.BadRequest(new { error = targetError });

    if (request.MilestoneType == MilestoneType.CustomDateRange)
    {
        if (request.CustomStartDate is null || request.CustomEndDate is null)
            return Results.BadRequest(new { error = "CustomStartDate and CustomEndDate are required for CustomDateRange" });
        if (request.CustomEndDate <= request.CustomStartDate)
            return Results.BadRequest(new { error = "CustomEndDate must be after CustomStartDate" });
        if (request.CustomEndDate <= DateTimeOffset.UtcNow)
            return Results.BadRequest(new { error = "CustomEndDate must be in the future" });
    }

    // Validate friendship via Social Service
    try
    {
        var socialClient = httpClientFactory.CreateClient("SocialService");
        using var friendCheck = await socialClient.GetAsync(
            $"/social/internal/friends/{userId}/{request.RecipientId}");

        if (friendCheck.IsSuccessStatusCode)
        {
            // friendship confirmed — continue
        }
        else if (friendCheck.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return Results.BadRequest(new { error = "You can only challenge friends" });
        }
        else
        {
            logger.LogWarning("Social Service returned {StatusCode} checking friendship between {CreatorId} and {RecipientId}",
                (int)friendCheck.StatusCode, userId, request.RecipientId);
            return Results.StatusCode(503);
        }
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
        logger.LogWarning(ex, "Failed to validate friendship between {CreatorId} and {RecipientId}",
            userId, request.RecipientId);
        return Results.StatusCode(503);
    }

    // Expire stale challenges that are still Active in the DB but past their end date.
    // This clears the unique index slot so a new challenge can be created for the same triple.
    await db.Challenges
        .Where(c => c.CreatorId == userId
            && c.RecipientId == request.RecipientId
            && c.HabitId == request.HabitId
            && c.Status == ChallengeStatus.Active
            && c.EndsAt <= DateTimeOffset.UtcNow)
        .ExecuteUpdateAsync(s => s
            .SetProperty(c => c.Status, ChallengeStatus.Expired)
            .SetProperty(c => c.UpdatedAt, DateTimeOffset.UtcNow));

    var endsAt = request.MilestoneType == MilestoneType.CustomDateRange && request.CustomEndDate is not null
        ? request.CustomEndDate.Value
        : DateTimeOffset.UtcNow.AddDays(request.PeriodDays);

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
        EndsAt = endsAt,
        CustomStartDate = request.CustomStartDate,
        CustomEndDate = request.CustomEndDate
    };

    db.Challenges.Add(challenge);

    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateException ex) when (ex.InnerException?.Message.Contains("ix_challenges_unique_active") == true)
    {
        return Results.Conflict(new { error = "An active challenge already exists for this habit and recipient" });
    }

    try
    {
        await nats.PublishAsync(Subjects.ChallengeCreated,
            new ChallengeCreatedEvent(challenge.Id, userId, request.RecipientId, request.HabitId));
    }
    catch (Exception ex) when (ex is NatsException or OperationCanceledException)
    {
        logger.LogWarning(ex, "Failed to publish challenge.created event for ChallengeId={ChallengeId}",
            challenge.Id);
    }

    return Results.Created($"/challenges/{challenge.Id}", MapToResponse(challenge));
});

// --- GET /challenges ---

app.MapGet("/challenges", async (HttpContext ctx, ChallengeDbContext db,
    IHttpClientFactory httpClientFactory, ILogger<Program> logger,
    int page = 1, int pageSize = 20,
    string? status = null, DateTimeOffset? since = null) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    page = Math.Max(1, page);
    pageSize = Math.Clamp(pageSize, 1, 100);

    var query = db.Challenges
        .Where(c => c.CreatorId == userId || c.RecipientId == userId);

    // Optional status filter — operates on effective/derived status, not raw DB status.
    // EffectiveStatus() rewrites overdue active challenges (Active + EndsAt in the past) as "expired",
    // so the filter must match that same contract.
    if (!string.IsNullOrEmpty(status) && Enum.TryParse<ChallengeStatus>(status, ignoreCase: true, out var statusEnum))
    {
        var now = DateTimeOffset.UtcNow;
        query = statusEnum switch
        {
            ChallengeStatus.Active => query.Where(c => c.Status == ChallengeStatus.Active && c.EndsAt > now),
            ChallengeStatus.Expired => query.Where(c =>
                c.Status == ChallengeStatus.Expired
                || (c.Status == ChallengeStatus.Active && c.EndsAt <= now)),
            _ => query.Where(c => c.Status == statusEnum)
        };
    }

    // Optional since filter — only return challenges updated after this timestamp
    if (since is not null)
    {
        query = query.Where(c => c.UpdatedAt >= since.Value);
    }

    var total = await query.CountAsync();
    var challenges = await query
        .OrderByDescending(c => c.CreatedAt)
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync();

    // Enrich with creator display names from Auth Service
    var creatorIds = challenges.Select(c => c.CreatorId).Distinct().ToList();
    var displayNames = await FetchDisplayNames(httpClientFactory, creatorIds, logger);

    return Results.Ok(new
    {
        items = challenges.Select(c => MapToDetailResponse(c, displayNames.GetValueOrDefault(c.CreatorId))),
        page,
        pageSize,
        total
    });
});

// --- GET /challenges/{id} ---

app.MapGet("/challenges/{id:guid}", async (Guid id, HttpContext ctx, ChallengeDbContext db,
    IHttpClientFactory httpClientFactory, ILogger<Program> logger) =>
{
    if (!TryGetUserId(ctx, out var userId))
        return Results.BadRequest(new { error = "Missing X-User-Id header" });

    var challenge = await db.Challenges
        .FirstOrDefaultAsync(c => c.Id == id && (c.CreatorId == userId || c.RecipientId == userId));

    if (challenge is null)
        return Results.NotFound();

    var displayNames = await FetchDisplayNames(httpClientFactory, [challenge.CreatorId], logger);

    return Results.Ok(MapToDetailResponse(challenge, displayNames.GetValueOrDefault(challenge.CreatorId)));
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

// --- Internal export endpoint (service-to-service, per export-contracts.md) ---

app.MapGet("/challenges/internal/export/{userId:guid}", async (Guid userId, ChallengeDbContext db) =>
{
    var hasChallenges = await db.Challenges.AnyAsync(c => c.CreatorId == userId || c.RecipientId == userId);

    if (!hasChallenges)
        return Results.NotFound();

    var challenges = await db.Challenges
        .Where(c => c.CreatorId == userId || c.RecipientId == userId)
        .OrderByDescending(c => c.CreatedAt)
        .ToListAsync();

    return Results.Ok(new
    {
        service = "challenge",
        data = new
        {
            challenges = challenges.Select(c => new
            {
                challengeId = c.Id,
                fromUserId = c.CreatorId,
                toUserId = c.RecipientId,
                habitId = c.HabitId,
                reward = c.RewardDescription,
                status = EffectiveStatus(c),
                createdAt = c.CreatedAt,
                completedAt = c.CompletedAt
            })
        }
    });
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

static string EffectiveStatus(Challenge c) =>
    c.Status == ChallengeStatus.Expired
    || (c.Status == ChallengeStatus.Active && c.EndsAt <= DateTimeOffset.UtcNow)
        ? "expired"
        : c.Status.ToString().ToLowerInvariant();

static object MapToResponse(Challenge c) => new
{
    id = c.Id,
    habitId = c.HabitId,
    creatorId = c.CreatorId,
    recipientId = c.RecipientId,
    milestoneType = JsonNamingPolicy.CamelCase.ConvertName(c.MilestoneType.ToString()),
    targetValue = c.TargetValue,
    periodDays = c.PeriodDays,
    rewardDescription = c.RewardDescription,
    status = EffectiveStatus(c),
    createdAt = c.CreatedAt,
    endsAt = c.EndsAt,
    completedAt = c.CompletedAt,
    claimedAt = c.ClaimedAt
};

static object MapToDetailResponse(Challenge c, string? creatorDisplayName = null) => new
{
    id = c.Id,
    habitId = c.HabitId,
    creatorId = c.CreatorId,
    recipientId = c.RecipientId,
    milestoneType = JsonNamingPolicy.CamelCase.ConvertName(c.MilestoneType.ToString()),
    targetValue = c.TargetValue,
    periodDays = c.PeriodDays,
    rewardDescription = c.RewardDescription,
    status = EffectiveStatus(c),
    progress = c.CurrentProgress,
    completionCount = c.CompletionCount,
    baselineConsistency = c.BaselineConsistency,
    customStartDate = c.CustomStartDate,
    customEndDate = c.CustomEndDate,
    creatorDisplayName,
    createdAt = c.CreatedAt,
    endsAt = c.EndsAt,
    completedAt = c.CompletedAt,
    claimedAt = c.ClaimedAt
};

static string? ValidateTargetValue(CreateChallengeRequest request)
{
    return request.MilestoneType switch
    {
        MilestoneType.ConsistencyTarget when request.TargetValue <= 0 || request.TargetValue > 100
            => "TargetValue must be between 1 and 100",
        MilestoneType.DaysInPeriod when request.TargetValue <= 0 || request.TargetValue > request.PeriodDays
            => $"TargetValue must be between 1 and {request.PeriodDays} (PeriodDays)",
        MilestoneType.TotalCompletions when request.TargetValue <= 0 || request.TargetValue > 10000
            => "TargetValue must be between 1 and 10000",
        MilestoneType.CustomDateRange when request.TargetValue <= 0 || request.TargetValue > 100
            => "TargetValue must be between 1 and 100",
        MilestoneType.ImprovementMilestone when request.TargetValue <= 0 || request.TargetValue > 100
            => "TargetValue must be between 1 and 100",
        _ => null
    };
}

static async Task<Dictionary<Guid, string>> FetchDisplayNames(
    IHttpClientFactory httpClientFactory, List<Guid> userIds, ILogger logger)
{
    if (userIds.Count == 0)
        return [];

    try
    {
        var authClient = httpClientFactory.CreateClient("AuthService");
        using var response = await authClient.PostAsJsonAsync("/auth/internal/profiles",
            new { userIds });

        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Auth Service batch profiles returned {StatusCode}", response.StatusCode);
            return [];
        }

        var profiles = await response.Content.ReadFromJsonAsync<List<ProfileInfo>>(
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        return profiles?
            .Where(p => p.DisplayName is not null)
            .ToDictionary(p => p.UserId, p => p.DisplayName!) ?? [];
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
    {
        logger.LogWarning(ex, "Failed to fetch batch profiles from Auth Service");
        return [];
    }
}

internal record ProfileInfo(Guid UserId, string Username, string? DisplayName);

// --- Request DTOs ---

internal record CreateChallengeRequest(
    Guid HabitId,
    Guid RecipientId,
    MilestoneType MilestoneType,
    double TargetValue,
    int PeriodDays,
    string RewardDescription,
    DateTimeOffset? CustomStartDate = null,
    DateTimeOffset? CustomEndDate = null);

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
