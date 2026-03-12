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

public sealed class ChallengeCompletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<ChallengeCompletedSubscriber> logger)
    : NatsEventSubscriber<ChallengeCompletedEvent>(
        connection,
        stream: "CHALLENGES",
        consumer: "activity-service-challenge-completed",
        filterSubject: Subjects.ChallengeCompleted,
        logger)
{
    protected override async Task HandleAsync(ChallengeCompletedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing challenge.completed for ChallengeId={ChallengeId}, UserId={UserId}",
            data.ChallengeId, data.UserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var entry = new FeedEntry
        {
            ActorId = data.UserId,
            EventType = Subjects.ChallengeCompleted,
            Data = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                challengeId = data.ChallengeId,
                userId = data.UserId,
                reward = data.Reward
            }))
        };

        db.FeedEntries.Add(entry);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Created feed entry {EntryId} for challenge.completed, ChallengeId={ChallengeId}",
            entry.Id, data.ChallengeId);
    }
}
