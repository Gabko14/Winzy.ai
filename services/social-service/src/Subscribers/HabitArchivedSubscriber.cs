using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.SocialService.Data;

namespace Winzy.SocialService.Subscribers;

public sealed class HabitArchivedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<HabitArchivedSubscriber> logger)
    : NatsEventSubscriber<HabitArchivedEvent>(
        connection,
        stream: "HABITS",
        consumer: "social-service-habit-archived",
        filterSubject: Subjects.HabitArchived,
        logger)
{
    protected override async Task HandleAsync(HabitArchivedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing habit.archived for UserId={UserId}, HabitId={HabitId}",
            data.UserId, data.HabitId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SocialDbContext>();

        // Idempotent: DELETE WHERE is naturally safe on redelivery
        var deleted = await db.VisibilitySettings
            .Where(v => v.UserId == data.UserId && v.HabitId == data.HabitId)
            .ExecuteDeleteAsync(ct);

        if (deleted > 0)
        {
            logger.LogInformation(
                "Deleted visibility setting for UserId={UserId}, HabitId={HabitId}",
                data.UserId, data.HabitId);
        }
        else
        {
            logger.LogDebug(
                "No visibility setting found for UserId={UserId}, HabitId={HabitId}, nothing to clean up",
                data.UserId, data.HabitId);
        }
    }
}
