using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.HabitService.Data;

namespace Winzy.HabitService.Subscribers;

public sealed class UserDeletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<UserDeletedSubscriber> logger)
    : NatsEventSubscriber<UserDeletedEvent>(
        connection,
        stream: "USERS",
        consumer: "habit-service-user-deleted",
        filterSubject: Subjects.UserDeleted,
        logger)
{
    protected override async Task HandleAsync(UserDeletedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing user.deleted for UserId={UserId}", data.UserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HabitDbContext>();

        // Delete all completions first (avoid FK constraint issues), then habits
        var completionsDeleted = await db.Completions
            .Where(c => c.UserId == data.UserId)
            .ExecuteDeleteAsync(ct);

        var habitsDeleted = await db.Habits
            .Where(h => h.UserId == data.UserId)
            .ExecuteDeleteAsync(ct);

        logger.LogInformation(
            "Deleted {Habits} habits and {Completions} completions for UserId={UserId}",
            habitsDeleted, completionsDeleted, data.UserId);
    }
}
