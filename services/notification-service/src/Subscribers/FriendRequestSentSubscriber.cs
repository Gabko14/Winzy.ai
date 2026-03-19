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

public sealed class FriendRequestSentSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    PushDeliveryService pushDelivery,
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
        var existing = await db.Notifications
            .FirstOrDefaultAsync(n => n.IdempotencyKey == idempotencyKey, ct);

        if (existing is not null)
        {
            if (!existing.PushDelivered)
            {
                logger.LogInformation("Duplicate notification detected (key={Key}), retrying push delivery", idempotencyKey);
                try
                {
                    await pushDelivery.DeliverAsync(
                        db, data.ToUserId,
                        "New friend request",
                        "Someone sent you a friend request",
                        "/friends",
                        ct);
                    existing.PushDelivered = true;
                    await db.SaveChangesAsync(ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Failed to deliver push retry for UserId={ToUserId} — continuing", data.ToUserId);
                }
            }
            else
            {
                logger.LogInformation("Duplicate notification detected (key={Key}), push already delivered — skipping", idempotencyKey);
            }
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

        try
        {
            await pushDelivery.DeliverAsync(
                db, data.ToUserId,
                "New friend request",
                "Someone sent you a friend request",
                "/friends",
                ct);
            notification.PushDelivered = true;
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Failed to deliver push for UserId={ToUserId} — PushDelivered remains false", data.ToUserId);
        }
    }
}
