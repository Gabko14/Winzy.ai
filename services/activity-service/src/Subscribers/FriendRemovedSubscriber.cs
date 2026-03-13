using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.ActivityService.Data;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.ActivityService.Subscribers;

public sealed class FriendRemovedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<FriendRemovedSubscriber> logger)
    : NatsEventSubscriber<FriendRemovedEvent>(
        connection,
        stream: "FRIENDS",
        consumer: "activity-friend-removed",
        filterSubject: Subjects.FriendRemoved,
        logger)
{
    protected override async Task HandleAsync(FriendRemovedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing friend.removed for UserId1={UserId1}, UserId2={UserId2}",
            data.UserId1, data.UserId2);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var user1Str = data.UserId1.ToString();
        var user2Str = data.UserId2.ToString();

        // Soft-delete the friend.request.accepted entries between the pair.
        // These are no longer relevant after unfriending.
        // Uses raw SQL for JSONB matching (consistent with UserDeletedSubscriber pattern).
        // Only targets active entries (deleted_at IS NULL) — idempotent under redelivery.
        var friendEntries = await db.Database.ExecuteSqlAsync(
            $"""
            UPDATE feed_entries
            SET deleted_at = now(), updated_at = now()
            WHERE deleted_at IS NULL
              AND event_type = 'friend.request.accepted'
              AND (actor_id = {data.UserId1} OR actor_id = {data.UserId2})
              AND data IS NOT NULL
              AND (
                   (data->>'userId1' = {user1Str} AND data->>'userId2' = {user2Str})
                OR (data->>'userId1' = {user2Str} AND data->>'userId2' = {user1Str})
              )
            """, ct);

        // Note: We do NOT soft-delete habit entries here. Feed entries don't store
        // per-habit visibility, so we can't distinguish friends-only from public habits.
        // The read-time filter against Social Service is the authoritative privacy gate
        // and will correctly hide friends-only entries after unfriending.

        logger.LogInformation(
            "Soft-deleted {FriendCount} friendship entries for UserId1={UserId1}, UserId2={UserId2}",
            friendEntries, data.UserId1, data.UserId2);
    }
}
