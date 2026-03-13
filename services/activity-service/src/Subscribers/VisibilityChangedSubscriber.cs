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

        // Only act when visibility narrows (becomes more restrictive)
        if (!IsNarrowing(data.OldVisibility, data.NewVisibility))
        {
            logger.LogInformation(
                "Visibility change is not narrowing ({Old}->{New}), skipping cleanup",
                data.OldVisibility, data.NewVisibility);
            return;
        }

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ActivityDbContext>();

        var habitIdStr = data.HabitId.ToString();

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

    private static bool IsNarrowing(string oldVisibility, string newVisibility)
    {
        var oldRank = VisibilityRank(oldVisibility);
        var newRank = VisibilityRank(newVisibility);
        return newRank < oldRank;
    }

    private static int VisibilityRank(string visibility) => visibility.ToLowerInvariant() switch
    {
        "public" => 3,
        "friends" => 2,
        "private" => 1,
        _ => 0
    };
}
