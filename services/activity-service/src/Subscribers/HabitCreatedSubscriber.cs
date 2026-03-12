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

public sealed class HabitCreatedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<HabitCreatedSubscriber> logger)
    : NatsEventSubscriber<HabitCreatedEvent>(
        connection,
        stream: "HABITS",
        consumer: "activity-service-habit-created",
        filterSubject: Subjects.HabitCreated,
        logger)
{
    protected override async Task HandleAsync(HabitCreatedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing habit.created for UserId={UserId}, HabitId={HabitId}",
            data.UserId, data.HabitId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var entry = new FeedEntry
        {
            ActorId = data.UserId,
            EventType = Subjects.HabitCreated,
            Data = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                userId = data.UserId,
                habitId = data.HabitId,
                name = data.Name
            }))
        };

        db.FeedEntries.Add(entry);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Created feed entry {EntryId} for habit.created, ActorId={ActorId}, HabitId={HabitId}",
            entry.Id, data.UserId, data.HabitId);
    }
}
