using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.ActivityService.Data;
using Winzy.ActivityService.Entities;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.ActivityService.Subscribers;

public sealed class FriendRequestAcceptedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<FriendRequestAcceptedSubscriber> logger)
    : NatsEventSubscriber<FriendRequestAcceptedEvent>(
        connection,
        stream: "FRIENDS",
        consumer: "activity-service-friend-accepted",
        filterSubject: Subjects.FriendRequestAccepted,
        logger)
{
    protected override async Task HandleAsync(FriendRequestAcceptedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing friend.request.accepted for UserId1={UserId1}, UserId2={UserId2}",
            data.UserId1, data.UserId2);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        // Canonical ordering for the friendship pair key
        var pairKey = string.Compare(data.UserId1.ToString(), data.UserId2.ToString(), StringComparison.Ordinal) < 0
            ? $"{data.UserId1}:{data.UserId2}"
            : $"{data.UserId2}:{data.UserId1}";

        var idempotencyKey1 = $"friend.request.accepted:{pairKey}:1";
        var idempotencyKey2 = $"friend.request.accepted:{pairKey}:2";

        if (await db.FeedEntries.AnyAsync(e => e.IdempotencyKey == idempotencyKey1, ct))
        {
            logger.LogInformation("Duplicate friend.request.accepted skipped (key={Key})", idempotencyKey1);
            return;
        }

        var payload = JsonSerializer.Serialize(new
        {
            userId1 = data.UserId1,
            userId2 = data.UserId2
        });

        var entry1 = new FeedEntry
        {
            ActorId = data.UserId1,
            EventType = Subjects.FriendRequestAccepted,
            Data = JsonDocument.Parse(payload),
            IdempotencyKey = idempotencyKey1
        };

        var entry2 = new FeedEntry
        {
            ActorId = data.UserId2,
            EventType = Subjects.FriendRequestAccepted,
            Data = JsonDocument.Parse(payload),
            IdempotencyKey = idempotencyKey2
        };

        db.FeedEntries.AddRange(entry1, entry2);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Created feed entries {EntryId1}, {EntryId2} for friend.request.accepted",
            entry1.Id, entry2.Id);
    }
}
