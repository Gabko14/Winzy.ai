using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.SocialService.Data;
using Winzy.SocialService.Entities;

namespace Winzy.SocialService.Subscribers;

public sealed class HabitCreatedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<HabitCreatedSubscriber> logger)
    : NatsEventSubscriber<HabitCreatedEvent>(
        connection,
        stream: "HABITS",
        consumer: "social-service-habit-created",
        filterSubject: Subjects.HabitCreated,
        logger)
{
    protected override async Task HandleAsync(HabitCreatedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing habit.created for UserId={UserId}, HabitId={HabitId}",
            data.UserId, data.HabitId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SocialDbContext>();

        // Look up user's default visibility preference
        var preference = await db.SocialPreferences
            .FirstOrDefaultAsync(p => p.UserId == data.UserId, ct);
        var defaultVisibility = preference?.DefaultHabitVisibility ?? HabitVisibility.Private;

        // Idempotent: ON CONFLICT DO NOTHING (if row already exists, skip)
        var exists = await db.VisibilitySettings
            .AnyAsync(v => v.UserId == data.UserId && v.HabitId == data.HabitId, ct);

        if (exists)
        {
            logger.LogDebug("Visibility row already exists for UserId={UserId}, HabitId={HabitId}, skipping",
                data.UserId, data.HabitId);
            return;
        }

        db.VisibilitySettings.Add(new VisibilitySetting
        {
            UserId = data.UserId,
            HabitId = data.HabitId,
            Visibility = defaultVisibility
        });

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Initialized visibility to {Visibility} for UserId={UserId}, HabitId={HabitId}",
            defaultVisibility, data.UserId, data.HabitId);
    }
}
