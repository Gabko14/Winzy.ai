using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.NotificationService.Data;

namespace Winzy.NotificationService.Subscribers;

public sealed class UserDeletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<UserDeletedSubscriber> logger)
    : NatsEventSubscriber<UserDeletedEvent>(
        connection,
        stream: "USERS",
        consumer: "notification-service-user-deleted",
        filterSubject: Subjects.UserDeleted,
        logger)
{
    protected override async Task HandleAsync(UserDeletedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing user.deleted for UserId={UserId}", data.UserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        var notificationsDeleted = await db.Notifications
            .Where(n => n.UserId == data.UserId)
            .ExecuteDeleteAsync(ct);

        var settingsDeleted = await db.NotificationSettings
            .Where(s => s.UserId == data.UserId)
            .ExecuteDeleteAsync(ct);

        logger.LogInformation(
            "Deleted {Notifications} notifications and {Settings} settings rows for UserId={UserId}",
            notificationsDeleted, settingsDeleted, data.UserId);
    }
}
