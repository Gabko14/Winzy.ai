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

public sealed class UserRegisteredSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<UserRegisteredSubscriber> logger)
    : NatsEventSubscriber<UserRegisteredEvent>(
        connection,
        stream: "USERS",
        consumer: "activity-service-user-registered",
        filterSubject: Subjects.UserRegistered,
        logger)
{
    protected override async Task HandleAsync(UserRegisteredEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing user.registered for UserId={UserId}, Username={Username}",
            data.UserId, data.Username);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var idempotencyKey = $"user.registered:{data.UserId}";
        if (await db.FeedEntries.AnyAsync(e => e.IdempotencyKey == idempotencyKey, ct))
        {
            logger.LogInformation("Duplicate user.registered skipped (key={Key})", idempotencyKey);
            return;
        }

        var entry = new FeedEntry
        {
            ActorId = data.UserId,
            EventType = Subjects.UserRegistered,
            Data = JsonDocument.Parse(JsonSerializer.Serialize(new { userId = data.UserId, username = data.Username })),
            IdempotencyKey = idempotencyKey
        };

        db.FeedEntries.Add(entry);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Created feed entry {EntryId} for user.registered, ActorId={ActorId}",
            entry.Id, data.UserId);
    }
}
