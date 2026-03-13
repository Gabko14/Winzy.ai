using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.ChallengeService.Data;
using Winzy.ChallengeService.Entities;
using Winzy.ChallengeService.Services;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.ChallengeService.Subscribers;

public sealed class HabitCompletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<HabitCompletedSubscriber> logger)
    : NatsEventSubscriber<HabitCompletedEvent>(
        connection,
        stream: "HABITS",
        consumer: "challenge-service-habit-completed",
        filterSubject: Subjects.HabitCompleted,
        logger)
{
    protected override async Task HandleAsync(HabitCompletedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing habit.completed for UserId={UserId}, HabitId={HabitId}, Consistency={Consistency}",
            data.UserId, data.HabitId, data.Consistency);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChallengeDbContext>();
        var nats = scope.ServiceProvider.GetRequiredService<NatsEventPublisher>();

        // Find active challenges for this habit where the user is the recipient
        var activeChallenges = await db.Challenges
            .Where(c => c.HabitId == data.HabitId
                && c.RecipientId == data.UserId
                && c.Status == ChallengeStatus.Active
                && c.EndsAt > DateTimeOffset.UtcNow)
            .ToListAsync(ct);

        if (activeChallenges.Count == 0)
        {
            logger.LogDebug("No active challenges found for HabitId={HabitId}, UserId={UserId}",
                data.HabitId, data.UserId);
            return;
        }

        var httpClientFactory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();

        foreach (var challenge in activeChallenges)
        {
            var completionDate = DateOnly.FromDateTime(data.Date);

            // For count-based milestones, only count completions on or after challenge creation
            if (challenge.MilestoneType is MilestoneType.DaysInPeriod or MilestoneType.TotalCompletions)
            {
                var challengeStart = DateOnly.FromDateTime(challenge.CreatedAt.UtcDateTime);
                if (completionDate >= challengeStart)
                {
                    var processedDates = challenge.GetProcessedDates();
                    if (!processedDates.Add(completionDate))
                    {
                        logger.LogDebug(
                            "Completion on {Date} already processed for challenge {ChallengeId}, skipping",
                            completionDate, challenge.Id);
                        continue;
                    }
                    challenge.SetProcessedDates(processedDates);
                }
                else
                {
                    logger.LogDebug(
                        "Skipping completion dated {Date} for challenge {ChallengeId} — before challenge creation {CreatedAt}",
                        data.Date, challenge.Id, challenge.CreatedAt);
                    continue;
                }
            }

            // For custom date range, only count completions within the custom window
            if (challenge.MilestoneType == MilestoneType.CustomDateRange)
            {
                var rangeStart = challenge.CustomStartDate is not null
                    ? DateOnly.FromDateTime(challenge.CustomStartDate.Value.UtcDateTime)
                    : DateOnly.FromDateTime(challenge.CreatedAt.UtcDateTime);

                if (completionDate < rangeStart)
                {
                    logger.LogDebug(
                        "Skipping completion dated {Date} for custom-range challenge {ChallengeId} — before range start {RangeStart}",
                        data.Date, challenge.Id, rangeStart);
                    continue;
                }

                var processedDates = challenge.GetProcessedDates();
                if (!processedDates.Add(completionDate))
                {
                    logger.LogDebug(
                        "Completion on {Date} already processed for custom-range challenge {ChallengeId}, skipping",
                        completionDate, challenge.Id);
                    continue;
                }
                challenge.SetProcessedDates(processedDates);
            }

            // For improvement milestones, only process events on or after challenge creation
            if (challenge.MilestoneType == MilestoneType.ImprovementMilestone)
            {
                var challengeStart = DateOnly.FromDateTime(challenge.CreatedAt.UtcDateTime);
                if (completionDate < challengeStart)
                {
                    logger.LogDebug(
                        "Skipping completion dated {Date} for improvement challenge {ChallengeId} — before challenge creation {CreatedAt}",
                        data.Date, challenge.Id, challenge.CreatedAt);
                    continue;
                }

                if (challenge.BaselineConsistency is null)
                {
                    challenge.BaselineConsistency = data.Consistency;
                    logger.LogInformation(
                        "Challenge {ChallengeId} baseline captured at {Baseline}%",
                        challenge.Id, data.Consistency);
                }
            }

            // Use range-specific consistency for CustomDateRange, global consistency for all others
            var effectiveConsistency = data.Consistency;
            if (challenge.MilestoneType == MilestoneType.CustomDateRange)
            {
                var rangeConsistency = await FetchRangeConsistencyAsync(
                    httpClientFactory, data.HabitId, challenge, data.Timezone, ct);
                if (rangeConsistency.HasValue)
                    effectiveConsistency = rangeConsistency.Value;
            }
            var ctx = new MilestoneContext(effectiveConsistency, data.Date);

            // Always update progress so GET /challenges/{id} returns current state
            challenge.CurrentProgress = ProgressCalculator.CalculateProgress(challenge, ctx);

            if (!ProgressCalculator.IsMilestoneReached(challenge, ctx))
            {
                logger.LogDebug(
                    "Challenge {ChallengeId} progress updated — {Progress:P0}",
                    challenge.Id, challenge.CurrentProgress);
                continue;
            }

            challenge.Status = ChallengeStatus.Completed;
            challenge.CurrentProgress = 1.0;
            challenge.CompletedAt = DateTimeOffset.UtcNow;

            logger.LogInformation(
                "Challenge {ChallengeId} completed! Type={MilestoneType}, Reward: {Reward}",
                challenge.Id, challenge.MilestoneType, challenge.RewardDescription);
        }

        // Collect completion events BEFORE saving — we need the list regardless of save order.
        var completedChallenges = activeChallenges
            .Where(c => c.Status == ChallengeStatus.Completed && c.CompletedAt is not null)
            .ToList();

        // Publish BEFORE persisting. If publish fails, the exception propagates to
        // NatsEventSubscriber which NAKs the message for redelivery. Because we haven't
        // saved yet, the challenges remain Active in the DB, so the retry will find and
        // reprocess them cleanly. If publish succeeds but SaveChanges fails, the NAK
        // causes a retry which may re-publish (downstream consumers must be idempotent),
        // but no completion event is permanently lost.
        foreach (var challenge in completedChallenges)
        {
            await nats.PublishAsync(Subjects.ChallengeCompleted,
                new ChallengeCompletedEvent(challenge.Id, data.UserId, challenge.RewardDescription), ct);
        }

        await db.SaveChangesAsync(ct);
    }

    private async Task<double?> FetchRangeConsistencyAsync(
        IHttpClientFactory httpClientFactory, Guid habitId, Challenge challenge, string? timezone, CancellationToken ct)
    {
        var from = challenge.CustomStartDate is not null
            ? DateOnly.FromDateTime(challenge.CustomStartDate.Value.UtcDateTime)
            : DateOnly.FromDateTime(challenge.CreatedAt.UtcDateTime);
        var to = challenge.CustomEndDate is not null
            ? DateOnly.FromDateTime(challenge.CustomEndDate.Value.UtcDateTime)
            : DateOnly.FromDateTime(DateTimeOffset.UtcNow.UtcDateTime);

        try
        {
            var habitClient = httpClientFactory.CreateClient("HabitService");
            var url = $"/habits/internal/{habitId}/consistency?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}";
            if (!string.IsNullOrWhiteSpace(timezone))
                url += $"&tz={Uri.EscapeDataString(timezone)}";
            using var response = await habitClient.GetAsync(url, ct);

            if (response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadFromJsonAsync<ConsistencyResponse>(
                    ConsistencyResponse.JsonOptions, ct);
                return body?.Consistency;
            }

            logger.LogWarning(
                "Habit service returned {StatusCode} for range consistency on HabitId={HabitId}",
                (int)response.StatusCode, habitId);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(ex,
                "Failed to fetch range consistency from habit service for HabitId={HabitId}",
                habitId);
        }

        return null;
    }

    private record ConsistencyResponse(double Consistency)
    {
        internal static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };
    }
}
