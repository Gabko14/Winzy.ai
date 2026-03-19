using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;
using Winzy.NotificationService.Data;
using Winzy.NotificationService.Entities;
using Winzy.NotificationService.Services;

namespace Winzy.NotificationService.Subscribers;

public sealed class HabitCompletedSubscriber(
    INatsConnection connection,
    IServiceProvider serviceProvider,
    IHttpClientFactory httpClientFactory,
    PushDeliveryService pushDelivery,
    ILogger<HabitCompletedSubscriber> logger)
    : NatsEventSubscriber<HabitCompletedEvent>(
        connection,
        stream: "HABITS",
        consumer: "notification-service-habit-completed",
        filterSubject: Subjects.HabitCompleted,
        logger)
{
    protected override async Task HandleAsync(HabitCompletedEvent data, CancellationToken ct)
    {
        logger.LogInformation(
            "Processing habit.completed for UserId={UserId}, HabitId={HabitId}",
            data.UserId, data.HabitId);

        // Resolve friends from social-service
        List<Guid> friendIds;
        try
        {
            var client = httpClientFactory.CreateClient("SocialService");
            using var response = await client.GetAsync($"/social/internal/friends/{data.UserId}", ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Social service returned {StatusCode} for friends lookup of UserId={UserId} — skipping fan-out",
                    response.StatusCode, data.UserId);
                return;
            }

            var body = await response.Content.ReadFromJsonAsync<FriendsResponse>(ct);
            friendIds = body?.FriendIds ?? [];
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(ex,
                "Failed to fetch friends from social service for UserId={UserId} — skipping fan-out",
                data.UserId);
            return;
        }

        if (friendIds.Count == 0)
        {
            logger.LogInformation(
                "No friends found for UserId={UserId} — no fan-out needed", data.UserId);
            return;
        }

        logger.LogInformation(
            "Fan-out habit.completed for UserId={UserId} to {FriendCount} friends",
            data.UserId, friendIds.Count);

        foreach (var friendId in friendIds)
        {
            if (friendId == data.UserId)
                continue;

            try
            {
                using var scope = serviceProvider.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

                var settings = await db.NotificationSettings
                    .FirstOrDefaultAsync(s => s.UserId == friendId, ct);

                if (settings is not null && !settings.FriendActivity)
                {
                    logger.LogInformation(
                        "Skipping habit.completed notification for FriendId={FriendId} — FriendActivity disabled",
                        friendId);
                    continue;
                }

                var idempotencyKey = $"habit_completed:{friendId}:{data.UserId}:{data.HabitId}:{data.Date:yyyy-MM-dd}";
                if (await db.Notifications.AnyAsync(n => n.IdempotencyKey == idempotencyKey, ct))
                {
                    logger.LogInformation("Duplicate notification detected (key={Key}), retrying push delivery", idempotencyKey);
                    await pushDelivery.DeliverAsync(
                        db, friendId,
                        "Friend completed a habit!",
                        "A friend just completed a habit",
                        "/friends",
                        ct);
                    continue;
                }

                var notification = new Notification
                {
                    UserId = friendId,
                    Type = NotificationType.HabitCompleted,
                    Data = JsonSerializer.Serialize(new
                    {
                        fromUserId = data.UserId,
                        habitId = data.HabitId,
                        date = data.Date.ToString("yyyy-MM-dd"),
                        consistency = data.Consistency
                    }),
                    IdempotencyKey = idempotencyKey
                };

                db.Notifications.Add(notification);
                await db.SaveChangesAsync(ct);

                logger.LogInformation(
                    "Created HabitCompleted notification {NotificationId} for FriendId={FriendId} from UserId={UserId}",
                    notification.Id, friendId, data.UserId);

                await pushDelivery.DeliverAsync(
                    db, friendId,
                    "Friend completed a habit!",
                    "A friend just completed a habit",
                    "/friends",
                    ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex,
                    "Failed to create habit.completed notification for FriendId={FriendId} — continuing with remaining friends",
                    friendId);
            }
        }
    }

    private sealed record FriendsResponse(List<Guid> FriendIds);
}
