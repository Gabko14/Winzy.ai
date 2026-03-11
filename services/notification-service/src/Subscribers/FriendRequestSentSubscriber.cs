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

public sealed class FriendRequestSentSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<FriendRequestSentSubscriber> logger)
    : NatsEventSubscriber<FriendRequestSentEvent>(
        connection,
        stream: "FRIENDS",
        consumer: "notification-service-friend-request-sent",
        filterSubject: Subjects.FriendRequestSent,
        logger)
{
    protected override async Task HandleAsync(FriendRequestSentEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing friend.request.sent from UserId={FromUserId} to UserId={ToUserId}",
            data.FromUserId, data.ToUserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        var settings = await db.NotificationSettings
            .FirstOrDefaultAsync(s => s.UserId == data.ToUserId, ct);

        if (settings is not null && !settings.FriendActivity)
        {
            logger.LogInformation(
                "Skipping friend.request.sent notification for UserId={ToUserId} — FriendActivity disabled",
                data.ToUserId);
            return;
        }

        var idempotencyKey = $"friend_request_sent:{data.ToUserId}:{data.FromUserId}";
        if (await db.Notifications.AnyAsync(n => n.IdempotencyKey == idempotencyKey, ct))
        {
            logger.LogInformation("Duplicate friend.request.sent notification skipped (key={Key})", idempotencyKey);
            return;
        }

        var notification = new Notification
        {
            UserId = data.ToUserId,
            Type = NotificationType.FriendRequestSent,
            Data = JsonSerializer.Serialize(new { fromUserId = data.FromUserId }),
            IdempotencyKey = idempotencyKey
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Created FriendRequestSent notification {NotificationId} for UserId={ToUserId}",
            notification.Id, data.ToUserId);
    }
}
