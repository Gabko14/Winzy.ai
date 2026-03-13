using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.ActivityService.Data;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.ActivityService.Subscribers;

public sealed class UserDeletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<UserDeletedSubscriber> logger)
    : NatsEventSubscriber<UserDeletedEvent>(
        connection,
        stream: "USERS",
        consumer: "activity-service-user-deleted",
        filterSubject: Subjects.UserDeleted,
        logger)
{
    protected override async Task HandleAsync(UserDeletedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing user.deleted for UserId={UserId}", data.UserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        // Delete entries where the deleted user is the actor (including soft-deleted)
        var actorDeleted = await db.FeedEntries
            .IgnoreQueryFilters()
            .Where(e => e.ActorId == data.UserId)
            .ExecuteDeleteAsync(ct);

        // Delete entries that reference the deleted user in JSONB data
        // (e.g. friend.request.accepted entries where the other user is the actor
        // but the deleted user appears in the data payload).
        // Uses JSONB operators on known fields to avoid false-positive LIKE matches.
        var userIdStr = data.UserId.ToString();
        var refDeleted = await db.Database.ExecuteSqlAsync(
            $"""
            DELETE FROM feed_entries
            WHERE actor_id != {data.UserId}
              AND data IS NOT NULL
              AND (
                   data->>'userId' = {userIdStr}
                OR data->>'userId1' = {userIdStr}
                OR data->>'userId2' = {userIdStr}
                OR data->>'fromUserId' = {userIdStr}
                OR data->>'toUserId' = {userIdStr}
              )
            """, ct);

        logger.LogInformation(
            "Deleted {ActorCount} actor entries and {RefCount} referencing entries for UserId={UserId}",
            actorDeleted, refDeleted, data.UserId);
    }
}
