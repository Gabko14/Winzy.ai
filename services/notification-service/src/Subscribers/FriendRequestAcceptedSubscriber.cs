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

public sealed class FriendRequestAcceptedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    PushDeliveryService pushDelivery,
    ILogger<FriendRequestAcceptedSubscriber> logger)
    : NatsEventSubscriber<FriendRequestAcceptedEvent>(
        connection,
        stream: "FRIENDS",
        consumer: "notification-service-friend-request-accepted",
        filterSubject: Subjects.FriendRequestAccepted,
        logger)
{
    protected override async Task HandleAsync(FriendRequestAcceptedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing friend.request.accepted for UserId1={UserId1}, UserId2={UserId2}",
            data.UserId1, data.UserId2);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        // Batch both notifications in a single SaveChanges for atomicity (avoids duplicates on retry)
        await CreateBothIfAllowed(db, data.UserId1, data.UserId2, ct);
    }

    private async Task CreateBothIfAllowed(
        NotificationDbContext db, Guid userId1, Guid userId2, CancellationToken ct)
    {
        var settings1 = await db.NotificationSettings
            .FirstOrDefaultAsync(s => s.UserId == userId1, ct);
        var settings2 = await db.NotificationSettings
            .FirstOrDefaultAsync(s => s.UserId == userId2, ct);

        // Check idempotency — load existing notifications (need PushDelivered flag)
        var key1 = $"friend_request_accepted:{userId1}:{userId2}";
        var key2 = $"friend_request_accepted:{userId2}:{userId1}";
        var existingNotifications = await db.Notifications
            .Where(n => n.IdempotencyKey == key1 || n.IdempotencyKey == key2)
            .ToDictionaryAsync(n => n.IdempotencyKey!, ct);

        // If both keys already exist, this is a redelivery — only retry push if not already delivered
        if (existingNotifications.ContainsKey(key1) && existingNotifications.ContainsKey(key2))
        {
            logger.LogInformation("Duplicate notification detected (both keys exist) for UserId1={UserId1} and UserId2={UserId2}", userId1, userId2);

            if (settings1 is null || settings1.FriendActivity)
            {
                var existing1 = existingNotifications[key1];
                if (!existing1.PushDelivered)
                {
                    try
                    {
                        await pushDelivery.DeliverAsync(
                            db, userId1,
                            "Friend request accepted",
                            "Your friend request was accepted!",
                            "/friends",
                            ct);
                        existing1.PushDelivered = true;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        logger.LogWarning(ex, "Failed to deliver push retry for UserId={UserId} — continuing", userId1);
                    }
                }
                else
                {
                    logger.LogInformation("Push already delivered for UserId={UserId} — skipping", userId1);
                }
            }

            if (settings2 is null || settings2.FriendActivity)
            {
                var existing2 = existingNotifications[key2];
                if (!existing2.PushDelivered)
                {
                    try
                    {
                        await pushDelivery.DeliverAsync(
                            db, userId2,
                            "Friend request accepted",
                            "Your friend request was accepted!",
                            "/friends",
                            ct);
                        existing2.PushDelivered = true;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        logger.LogWarning(ex, "Failed to deliver push retry for UserId={UserId} — continuing", userId2);
                    }
                }
                else
                {
                    logger.LogInformation("Push already delivered for UserId={UserId} — skipping", userId2);
                }
            }

            // Best-effort save of PushDelivered flags
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Failed to save PushDelivered flag updates — push may be retried on redelivery");
            }

            return;
        }

        // Partial delivery: one key may exist (from a previous crash) while the other doesn't.
        // We need to create missing notifications AND retry push for existing ones with PushDelivered=false.
        var created = new List<Notification>();
        var pushRetryExisting = new List<Notification>();

        if (!existingNotifications.ContainsKey(key1) && (settings1 is null || settings1.FriendActivity))
        {
            var n = new Notification
            {
                UserId = userId1,
                Type = NotificationType.FriendRequestAccepted,
                Data = JsonSerializer.Serialize(new { otherUserId = userId2 }),
                IdempotencyKey = key1
            };
            db.Notifications.Add(n);
            created.Add(n);
        }
        else if (existingNotifications.TryGetValue(key1, out var existing1))
        {
            if (!existing1.PushDelivered && (settings1 is null || settings1.FriendActivity))
                pushRetryExisting.Add(existing1);
            else
                logger.LogInformation("Duplicate friend.request.accepted notification skipped for UserId={UserId}", userId1);
        }
        else
        {
            logger.LogInformation(
                "Skipping friend.request.accepted notification for UserId={UserId} — FriendActivity disabled",
                userId1);
        }

        if (!existingNotifications.ContainsKey(key2) && (settings2 is null || settings2.FriendActivity))
        {
            var n = new Notification
            {
                UserId = userId2,
                Type = NotificationType.FriendRequestAccepted,
                Data = JsonSerializer.Serialize(new { otherUserId = userId1 }),
                IdempotencyKey = key2
            };
            db.Notifications.Add(n);
            created.Add(n);
        }
        else if (existingNotifications.TryGetValue(key2, out var existing2))
        {
            if (!existing2.PushDelivered && (settings2 is null || settings2.FriendActivity))
                pushRetryExisting.Add(existing2);
            else
                logger.LogInformation("Duplicate friend.request.accepted notification skipped for UserId={UserId}", userId2);
        }
        else
        {
            logger.LogInformation(
                "Skipping friend.request.accepted notification for UserId={UserId} — FriendActivity disabled",
                userId2);
        }

        if (created.Count > 0)
        {
            await db.SaveChangesAsync(ct);
            foreach (var n in created)
            {
                logger.LogInformation(
                    "Created FriendRequestAccepted notification {NotificationId} for UserId={UserId}",
                    n.Id, n.UserId);

                try
                {
                    await pushDelivery.DeliverAsync(
                        db, n.UserId,
                        "Friend request accepted",
                        "Your friend request was accepted!",
                        "/friends",
                        ct);
                    n.PushDelivered = true;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex,
                        "Failed to deliver push for UserId={UserId} — continuing",
                        n.UserId);
                }
            }
        }

        // Retry push for existing notifications that weren't delivered (partial delivery scenario)
        foreach (var existing in pushRetryExisting)
        {
            logger.LogInformation("Retrying push for existing notification UserId={UserId}", existing.UserId);
            try
            {
                await pushDelivery.DeliverAsync(
                    db, existing.UserId,
                    "Friend request accepted",
                    "Your friend request was accepted!",
                    "/friends",
                    ct);
                existing.PushDelivered = true;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Failed to deliver push retry for UserId={UserId} — continuing", existing.UserId);
            }
        }

        // Best-effort save of PushDelivered flags
        if (created.Count > 0 || pushRetryExisting.Count > 0)
        {
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Failed to save PushDelivered flag updates — push may be retried on redelivery");
            }
        }
    }
}
