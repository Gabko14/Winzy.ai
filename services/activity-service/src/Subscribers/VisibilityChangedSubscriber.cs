using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.ActivityService.Data;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.ActivityService.Subscribers;

public sealed class VisibilityChangedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<VisibilityChangedSubscriber> logger)
    : NatsEventSubscriber<VisibilityChangedEvent>(
        connection,
        stream: "VISIBILITY",
        consumer: "activity-visibility-changed",
        filterSubject: Subjects.VisibilityChanged,
        logger)
{
    protected override async Task HandleAsync(VisibilityChangedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing visibility.changed for UserId={UserId}, HabitId={HabitId}, {Old}->{New}",
            data.UserId, data.HabitId, data.OldVisibility, data.NewVisibility);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var habitIdStr = data.HabitId.ToString();

        if (IsNarrowing(data.OldVisibility, data.NewVisibility))
        {
            // Soft-delete feed entries for this habit where the actor is the habit owner.
            // Uses raw SQL for JSONB matching (consistent with UserDeletedSubscriber pattern).
            // Only targets active entries (deleted_at IS NULL) — idempotent under redelivery.
            var affected = await db.Database.ExecuteSqlAsync(
                $"""
                UPDATE feed_entries
                SET deleted_at = now(), updated_at = now()
                WHERE actor_id = {data.UserId}
                  AND deleted_at IS NULL
                  AND event_type IN ('habit.created', 'habit.completed')
                  AND data IS NOT NULL
                  AND data->>'habitId' = {habitIdStr}
                """, ct);

            logger.LogInformation(
                "Soft-deleted {Count} feed entries for UserId={UserId}, HabitId={HabitId} after visibility narrowing",
                affected, data.UserId, data.HabitId);
        }
        else if (IsWidening(data.OldVisibility, data.NewVisibility))
        {
            // Restore soft-deleted feed entries when visibility widens.
            // Without this, a public→private→public cycle would permanently erase feed history
            // because the IdempotencyKey unique index covers soft-deleted rows, preventing re-insert.
            var restored = await db.Database.ExecuteSqlAsync(
                $"""
                UPDATE feed_entries
                SET deleted_at = NULL, updated_at = now()
                WHERE actor_id = {data.UserId}
                  AND deleted_at IS NOT NULL
                  AND event_type IN ('habit.created', 'habit.completed')
                  AND data IS NOT NULL
                  AND data->>'habitId' = {habitIdStr}
                """, ct);

            logger.LogInformation(
                "Restored {Count} feed entries for UserId={UserId}, HabitId={HabitId} after visibility widening",
                restored, data.UserId, data.HabitId);
        }
        else
        {
            logger.LogInformation(
                "Visibility unchanged ({Old}->{New}), skipping",
                data.OldVisibility, data.NewVisibility);
        }
    }

    private static bool IsNarrowing(string oldVisibility, string newVisibility)
    {
        var oldRank = VisibilityRank(oldVisibility);
        var newRank = VisibilityRank(newVisibility);
        return newRank < oldRank;
    }

    private static bool IsWidening(string oldVisibility, string newVisibility)
    {
        var oldRank = VisibilityRank(oldVisibility);
        var newRank = VisibilityRank(newVisibility);
        return newRank > oldRank;
    }

    private static int VisibilityRank(string visibility) => visibility.ToLowerInvariant() switch
    {
        "public" => 3,
        "friends" => 2,
        "private" => 1,
        _ => 0
    };
}
