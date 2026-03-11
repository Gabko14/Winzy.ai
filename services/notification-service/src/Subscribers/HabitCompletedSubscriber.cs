using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.NotificationService.Subscribers;

public sealed class HabitCompletedSubscriber(
    INatsConnection connection,
    ILogger<HabitCompletedSubscriber> logger)
    : NatsEventSubscriber<HabitCompletedEvent>(
        connection,
        stream: "HABITS",
        consumer: "notification-service-habit-completed",
        filterSubject: Subjects.HabitCompleted,
        logger)
{
    protected override Task HandleAsync(HabitCompletedEvent data, CancellationToken ct)
    {
        // TODO: Once the social service exposes an internal GET /friends/user/{userId} endpoint,
        // resolve the completing user's friends and create a HabitCompleted notification for
        // each friend (checking each friend's FriendActivity setting).
        // Self-notifications for habit completion don't make sense (user just did it),
        // so we skip entirely until friend fan-out is available.

        logger.LogInformation(
            "Skipping habit.completed for UserId={UserId}, HabitId={HabitId} — friend fan-out not yet implemented",
            data.UserId, data.HabitId);

        return Task.CompletedTask;
    }
}
