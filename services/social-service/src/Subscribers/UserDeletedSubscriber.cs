using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.SocialService.Data;

namespace Winzy.SocialService.Subscribers;

public sealed class UserDeletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<UserDeletedSubscriber> logger)
    : NatsEventSubscriber<UserDeletedEvent>(
        connection,
        stream: "USERS",
        consumer: "social-service-user-deleted",
        filterSubject: Subjects.UserDeleted,
        logger)
{
    protected override async Task HandleAsync(UserDeletedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing user.deleted for UserId={UserId}", data.UserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SocialDbContext>();

        // Delete witness link habits first (FK constraint), then witness links
        var witnessLinkIds = await db.WitnessLinks
            .Where(w => w.OwnerId == data.UserId)
            .Select(w => w.Id)
            .ToListAsync(ct);

        var witnessHabitsDeleted = 0;
        if (witnessLinkIds.Count > 0)
        {
            witnessHabitsDeleted = await db.WitnessLinkHabits
                .Where(wh => witnessLinkIds.Contains(wh.WitnessLinkId))
                .ExecuteDeleteAsync(ct);
        }

        var witnessLinksDeleted = await db.WitnessLinks
            .Where(w => w.OwnerId == data.UserId)
            .ExecuteDeleteAsync(ct);

        var preferencesDeleted = await db.SocialPreferences
            .Where(p => p.UserId == data.UserId)
            .ExecuteDeleteAsync(ct);

        var visibilityDeleted = await db.VisibilitySettings
            .Where(v => v.UserId == data.UserId)
            .ExecuteDeleteAsync(ct);

        var friendshipsDeleted = await db.Friendships
            .Where(f => f.UserId == data.UserId || f.FriendId == data.UserId)
            .ExecuteDeleteAsync(ct);

        logger.LogInformation(
            "Deleted {Friendships} friendships, {Visibility} visibility settings, {Preferences} preferences, {WitnessLinks} witness links, {WitnessHabits} witness link habits for UserId={UserId}",
            friendshipsDeleted, visibilityDeleted, preferencesDeleted, witnessLinksDeleted, witnessHabitsDeleted, data.UserId);
    }
}
