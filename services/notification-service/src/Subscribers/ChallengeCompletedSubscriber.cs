using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.NotificationService.Data;
using Winzy.NotificationService.Entities;
using Winzy.NotificationService.Services;

namespace Winzy.NotificationService.Subscribers;

public sealed class ChallengeCompletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    PushDeliveryService pushDelivery,
    ILogger<ChallengeCompletedSubscriber> logger)
    : NatsEventSubscriber<ChallengeCompletedEvent>(
        connection,
        stream: "CHALLENGES",
        consumer: "notification-service-challenge-completed",
        filterSubject: Subjects.ChallengeCompleted,
        logger)
{
    protected override async Task HandleAsync(ChallengeCompletedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing challenge.completed ChallengeId={ChallengeId} for UserId={UserId}",
            data.ChallengeId, data.UserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        var settings = await db.NotificationSettings
            .FirstOrDefaultAsync(s => s.UserId == data.UserId, ct);

        if (settings is not null && !settings.ChallengeUpdates)
        {
            logger.LogInformation(
                "Skipping challenge.completed notification for UserId={UserId} — ChallengeUpdates disabled",
                data.UserId);
            return;
        }

        var idempotencyKey = $"challenge_completed:{data.UserId}:{data.ChallengeId}";
        if (await db.Notifications.AnyAsync(n => n.IdempotencyKey == idempotencyKey, ct))
        {
            logger.LogInformation("Duplicate notification detected (key={Key}), retrying push delivery", idempotencyKey);
            await pushDelivery.DeliverAsync(
                db, data.UserId,
                "Challenge completed!",
                $"You completed a challenge — time for: {data.Reward}",
                "/challenges",
                ct);
            return;
        }

        var notification = new Notification
        {
            UserId = data.UserId,
            Type = NotificationType.ChallengeCompleted,
            Data = JsonSerializer.Serialize(new
            {
                challengeId = data.ChallengeId,
                reward = data.Reward
            }),
            IdempotencyKey = idempotencyKey
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Created ChallengeCompleted notification {NotificationId} for UserId={UserId}",
            notification.Id, data.UserId);

        await pushDelivery.DeliverAsync(
            db, data.UserId,
            "Challenge completed!",
            $"You completed a challenge — time for: {data.Reward}",
            "/challenges",
            ct);
    }
}
