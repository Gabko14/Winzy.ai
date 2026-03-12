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

public sealed class ChallengeCreatedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<ChallengeCreatedSubscriber> logger)
    : NatsEventSubscriber<ChallengeCreatedEvent>(
        connection,
        stream: "CHALLENGES",
        consumer: "activity-service-challenge-created",
        filterSubject: Subjects.ChallengeCreated,
        logger)
{
    protected override async Task HandleAsync(ChallengeCreatedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing challenge.created for ChallengeId={ChallengeId}, From={FromUserId}, To={ToUserId}",
            data.ChallengeId, data.FromUserId, data.ToUserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        // The actor is the creator of the challenge
        var entry = new FeedEntry
        {
            ActorId = data.FromUserId,
            EventType = Subjects.ChallengeCreated,
            Data = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                challengeId = data.ChallengeId,
                fromUserId = data.FromUserId,
                toUserId = data.ToUserId,
                habitId = data.HabitId
            }))
        };

        db.FeedEntries.Add(entry);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Created feed entry {EntryId} for challenge.created, ChallengeId={ChallengeId}",
            entry.Id, data.ChallengeId);
    }
}
