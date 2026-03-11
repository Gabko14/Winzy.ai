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

namespace Winzy.NotificationService.Subscribers;

public sealed class ChallengeCreatedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<ChallengeCreatedSubscriber> logger)
    : NatsEventSubscriber<ChallengeCreatedEvent>(
        connection,
        stream: "CHALLENGES",
        consumer: "notification-service-challenge-created",
        filterSubject: Subjects.ChallengeCreated,
        logger)
{
    protected override async Task HandleAsync(ChallengeCreatedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing challenge.created ChallengeId={ChallengeId} from UserId={FromUserId} to UserId={ToUserId}",
            data.ChallengeId, data.FromUserId, data.ToUserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        var settings = await db.NotificationSettings
            .FirstOrDefaultAsync(s => s.UserId == data.ToUserId, ct);

        if (settings is not null && !settings.ChallengeUpdates)
        {
            logger.LogInformation(
                "Skipping challenge.created notification for UserId={ToUserId} — ChallengeUpdates disabled",
                data.ToUserId);
            return;
        }

        var notification = new Notification
        {
            UserId = data.ToUserId,
            Type = NotificationType.ChallengeCreated,
            Data = JsonSerializer.Serialize(new
            {
                challengeId = data.ChallengeId,
                fromUserId = data.FromUserId,
                habitId = data.HabitId
            })
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Created ChallengeCreated notification {NotificationId} for UserId={ToUserId}",
            notification.Id, data.ToUserId);
    }
}
