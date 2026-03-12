using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.ActivityService.Data;
using Winzy.ActivityService.Entities;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.ActivityService.Subscribers;

public sealed class HabitCompletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<HabitCompletedSubscriber> logger)
    : NatsEventSubscriber<HabitCompletedEvent>(
        connection,
        stream: "HABITS",
        consumer: "activity-service-habit-completed",
        filterSubject: Subjects.HabitCompleted,
        logger)
{
    protected override async Task HandleAsync(HabitCompletedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing habit.completed for UserId={UserId}, HabitId={HabitId}, Consistency={Consistency}",
            data.UserId, data.HabitId, data.Consistency);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var entry = new FeedEntry
        {
            ActorId = data.UserId,
            EventType = Subjects.HabitCompleted,
            Data = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                userId = data.UserId,
                habitId = data.HabitId,
                date = data.Date,
                consistency = data.Consistency
            }))
        };

        db.FeedEntries.Add(entry);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Created feed entry {EntryId} for habit.completed, ActorId={ActorId}, HabitId={HabitId}",
            entry.Id, data.UserId, data.HabitId);
    }
}
