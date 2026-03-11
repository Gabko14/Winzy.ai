using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.ChallengeService.Data;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.ChallengeService.Subscribers;

public sealed class UserDeletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    ILogger<UserDeletedSubscriber> logger)
    : NatsEventSubscriber<UserDeletedEvent>(
        connection,
        stream: "USERS",
        consumer: "challenge-service-user-deleted",
        filterSubject: Subjects.UserDeleted,
        logger)
{
    protected override async Task HandleAsync(UserDeletedEvent data, CancellationToken ct)
    {
        logger.LogInformation("Processing user.deleted for UserId={UserId}", data.UserId);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChallengeDbContext>();

        // Cancel all active challenges where the user is creator or recipient
        var cancelled = await db.Challenges
            .Where(c => (c.CreatorId == data.UserId || c.RecipientId == data.UserId)
                && c.Status == Entities.ChallengeStatus.Active)
            .ExecuteUpdateAsync(s => s
                .SetProperty(c => c.Status, Entities.ChallengeStatus.Cancelled)
                .SetProperty(c => c.UpdatedAt, DateTimeOffset.UtcNow), ct);

        logger.LogInformation(
            "Cancelled {Count} challenges for deleted UserId={UserId}",
            cancelled, data.UserId);
    }
}
