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

        // Check idempotency — skip if already processed
        var key1 = $"friend_request_accepted:{userId1}:{userId2}";
        var key2 = $"friend_request_accepted:{userId2}:{userId1}";
        var existingKeys = await db.Notifications
            .Where(n => n.IdempotencyKey == key1 || n.IdempotencyKey == key2)
            .Select(n => n.IdempotencyKey)
            .ToListAsync(ct);

        // If both keys already exist, this is a redelivery — still attempt push (may have crashed after DB save)
        if (existingKeys.Contains(key1) && existingKeys.Contains(key2))
        {
            logger.LogInformation("Duplicate notification detected (both keys exist), retrying push delivery for UserId1={UserId1} and UserId2={UserId2}", userId1, userId2);
            if (settings1 is null || settings1.FriendActivity)
            {
                await pushDelivery.DeliverAsync(
                    db, userId1,
                    "Friend request accepted",
                    "Your friend request was accepted!",
                    "/friends",
                    ct);
            }
            if (settings2 is null || settings2.FriendActivity)
            {
                await pushDelivery.DeliverAsync(
                    db, userId2,
                    "Friend request accepted",
                    "Your friend request was accepted!",
                    "/friends",
                    ct);
            }
            return;
        }

        var created = new List<Notification>();

        if (!existingKeys.Contains(key1) && (settings1 is null || settings1.FriendActivity))
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
        else if (existingKeys.Contains(key1))
        {
            logger.LogInformation("Duplicate friend.request.accepted notification skipped for UserId={UserId}", userId1);
        }
        else
        {
            logger.LogInformation(
                "Skipping friend.request.accepted notification for UserId={UserId} — FriendActivity disabled",
                userId1);
        }

        if (!existingKeys.Contains(key2) && (settings2 is null || settings2.FriendActivity))
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
        else if (existingKeys.Contains(key2))
        {
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

                await pushDelivery.DeliverAsync(
                    db, n.UserId,
                    "Friend request accepted",
                    "Your friend request was accepted!",
                    "/friends",
                    ct);
            }
        }
    }
}
