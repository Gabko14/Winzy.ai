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

public sealed class HabitCompletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<HabitCompletedSubscriber> logger)
    : NatsEventSubscriber<HabitCompletedEvent>(
        connection,
        stream: "HABITS",
        consumer: "notification-service-habit-completed",
        filterSubject: Subjects.HabitCompleted,
        logger)
{
    protected override async Task HandleAsync(HabitCompletedEvent data, CancellationToken ct)
    {
        // TODO: Once the social service exposes an internal GET /friends/user/{userId} endpoint,
        // resolve the completing user's friends and create a HabitCompleted notification for
        // each friend (checking each friend's FriendActivity setting). Currently creates a
        // self-notification for the completing user as a habit reminder.

        logger.LogInformation(
            "Processing habit.completed for UserId={UserId}, HabitId={HabitId}",
            data.UserId, data.HabitId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        var settings = await db.NotificationSettings
            .FirstOrDefaultAsync(s => s.UserId == data.UserId, ct);

        if (settings is not null && !settings.HabitReminders)
        {
            logger.LogInformation(
                "Skipping habit.completed notification for UserId={UserId} — HabitReminders disabled",
                data.UserId);
            return;
        }

        var notification = new Notification
        {
            UserId = data.UserId,
            Type = NotificationType.HabitCompleted,
            Data = JsonSerializer.Serialize(new
            {
                habitId = data.HabitId,
                date = data.Date,
                consistency = data.Consistency
            })
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Created HabitCompleted notification {NotificationId} for UserId={UserId}",
            notification.Id, data.UserId);
    }
}
