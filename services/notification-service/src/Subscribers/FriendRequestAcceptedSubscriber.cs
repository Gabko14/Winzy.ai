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

public sealed class FriendRequestAcceptedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
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

        // Notify both users about the accepted friend request
        await CreateIfAllowed(db, data.UserId1, data.UserId2, ct);
        await CreateIfAllowed(db, data.UserId2, data.UserId1, ct);
    }

    private async Task CreateIfAllowed(
        NotificationDbContext db, Guid recipientId, Guid otherUserId, CancellationToken ct)
    {
        var settings = await db.NotificationSettings
            .FirstOrDefaultAsync(s => s.UserId == recipientId, ct);

        if (settings is not null && !settings.FriendActivity)
        {
            logger.LogInformation(
                "Skipping friend.request.accepted notification for UserId={UserId} — FriendActivity disabled",
                recipientId);
            return;
        }

        var notification = new Notification
        {
            UserId = recipientId,
            Type = NotificationType.FriendRequestAccepted,
            Data = JsonSerializer.Serialize(new { otherUserId })
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Created FriendRequestAccepted notification {NotificationId} for UserId={UserId}",
            notification.Id, recipientId);
    }
}
