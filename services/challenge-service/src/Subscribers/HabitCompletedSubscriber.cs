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

        foreach (var challenge in activeChallenges)
        {
            // Always update progress so GET /challenges/{id} returns current state
            challenge.CurrentProgress = ProgressCalculator.CalculateProgress(challenge, data.Consistency);

            if (!ProgressCalculator.IsMilestoneReached(challenge, data.Consistency))
            {
                logger.LogDebug(
                    "Challenge {ChallengeId} progress updated — consistency {Consistency} / target {Target} = {Progress:P0}",
                    challenge.Id, data.Consistency, challenge.TargetValue, challenge.CurrentProgress);
                continue;
            }

            challenge.Status = ChallengeStatus.Completed;
            challenge.CurrentProgress = 1.0;
            challenge.CompletedAt = DateTimeOffset.UtcNow;

            logger.LogInformation(
                "Challenge {ChallengeId} completed! Consistency {Consistency} >= target {Target}. Reward: {Reward}",
                challenge.Id, data.Consistency, challenge.TargetValue, challenge.RewardDescription);

            try
            {
                await nats.PublishAsync(Subjects.ChallengeCompleted,
                    new ChallengeCompletedEvent(challenge.Id, data.UserId, challenge.RewardDescription), ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to publish challenge.completed event for ChallengeId={ChallengeId}",
                    challenge.Id);
            }
        }

        await db.SaveChangesAsync(ct);
    }
}
