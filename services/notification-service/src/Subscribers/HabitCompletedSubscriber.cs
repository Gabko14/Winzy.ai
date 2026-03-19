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
                if ((int)response.StatusCode >= 500)
                {
                    // 5xx = transient server error → throw so base class NAKs for retry
                    throw new HttpRequestException(
                        $"Social service returned {(int)response.StatusCode} for friends lookup of UserId={data.UserId}");
                }

                // 4xx = permanent client error (user not found, forbidden, etc.) → ack
                logger.LogWarning(
                    "Social service returned {StatusCode} for friends lookup of UserId={UserId} — skipping fan-out",
                    response.StatusCode, data.UserId);
                return;
            }

            var body = await response.Content.ReadFromJsonAsync<FriendsResponse>(ct);
            friendIds = body?.FriendIds ?? [];
        }
        catch (JsonException)
        {
            // Permanent parse error — retry won't help, ack the message
            logger.LogWarning("Failed to parse social service response for UserId={UserId} — skipping fan-out", data.UserId);
            return;
        }
        catch (TaskCanceledException ex)
        {
            // TaskCanceledException can mean shutdown (ct cancelled) or HTTP timeout (HttpClient.Timeout).
            // Shutdown must propagate as OperationCanceledException to stop the subscriber loop gracefully.
            ct.ThrowIfCancellationRequested();
            // HTTP timeout: wrap as HttpRequestException so the base class NAK handler catches it.
            // (TaskCanceledException inherits OperationCanceledException, which the base class skips.)
            throw new HttpRequestException("Social service request timed out", ex);
        }
        // HttpRequestException propagates → NAK → JetStream retries (MaxDeliver=5)

        if (friendIds.Count == 0)
        {
            logger.LogInformation(
                "No friends found for UserId={UserId} — no fan-out needed", data.UserId);
            return;
        }

        // Filter out self-notification and deduplicate (social-service may return duplicates)
        var targetFriendIds = friendIds.Where(f => f != data.UserId).Distinct().ToList();
        if (targetFriendIds.Count == 0)
            return;

        logger.LogInformation(
            "Fan-out habit.completed for UserId={UserId} to {FriendCount} friends",
            data.UserId, targetFriendIds.Count);

        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        // Batch query: notification settings for all target friends
        var settingsMap = await db.NotificationSettings
            .Where(s => targetFriendIds.Contains(s.UserId))
            .ToDictionaryAsync(s => s.UserId, ct);

        // Filter friends who have FriendActivity disabled
        var eligibleFriendIds = targetFriendIds
            .Where(f => !settingsMap.TryGetValue(f, out var s) || s.FriendActivity)
            .ToList();

        if (eligibleFriendIds.Count == 0)
        {
            logger.LogInformation("All friends have FriendActivity disabled — no notifications to create");
            return;
        }

        // Build idempotency keys for all eligible friends
        // Key uses date-only precision intentionally — one notification per friend per habit per day
        var idempotencyKeys = eligibleFriendIds
            .ToDictionary(f => f, f => $"habit_completed:{f}:{data.UserId}:{data.HabitId}:{data.Date.ToString("yyyy-MM-dd")}");

        // Batch query: check which notifications already exist
        var allKeys = idempotencyKeys.Values.ToList();
        var existingNotifications = await db.Notifications
            .Where(n => allKeys.Contains(n.IdempotencyKey!))
            .ToDictionaryAsync(n => n.IdempotencyKey!, ct);

        // Build enriched notification text
        var (pushTitle, pushBody) = BuildPushText(data);

        // Separate friends into new notifications vs duplicates needing push retry
        var newNotifications = new List<Notification>();
        var pushRetryFriendIds = new List<Guid>();
        var pushNewFriendIds = new List<Guid>();

        foreach (var friendId in eligibleFriendIds)
        {
            var key = idempotencyKeys[friendId];

            if (existingNotifications.TryGetValue(key, out var existing))
            {
                // Duplicate detected — only retry push if not already delivered
                if (!existing.PushDelivered)
                {
                    pushRetryFriendIds.Add(friendId);
                    logger.LogInformation("Duplicate notification detected (key={Key}), retrying push delivery", key);
                }
                else
                {
                    logger.LogInformation("Duplicate notification detected (key={Key}), push already delivered — skipping", key);
                }
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
                IdempotencyKey = key
            };

            newNotifications.Add(notification);
            pushNewFriendIds.Add(friendId);
        }

        // Batch insert all new notifications
        if (newNotifications.Count > 0)
        {
            db.Notifications.AddRange(newNotifications);
            await db.SaveChangesAsync(ct);

            logger.LogInformation(
                "Created {Count} HabitCompleted notifications for UserId={UserId}",
                newNotifications.Count, data.UserId);
        }

        // Push delivery — per-friend (external calls can't batch)
        foreach (var friendId in pushNewFriendIds)
        {
            try
            {
                await pushDelivery.DeliverAsync(db, friendId, pushTitle, pushBody, "/friends", ct);

                // Mark push as delivered
                var key = idempotencyKeys[friendId];
                var notification = newNotifications.First(n => n.IdempotencyKey == key);
                notification.PushDelivered = true;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex,
                    "Failed to deliver push for new notification to FriendId={FriendId} — continuing",
                    friendId);
            }
        }

        // Retry push for duplicates that weren't delivered
        foreach (var friendId in pushRetryFriendIds)
        {
            try
            {
                await pushDelivery.DeliverAsync(db, friendId, pushTitle, pushBody, "/friends", ct);

                // Mark push as delivered on the existing notification
                var key = idempotencyKeys[friendId];
                var existing = existingNotifications[key];
                existing.PushDelivered = true;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex,
                    "Failed to deliver push retry for FriendId={FriendId} — continuing",
                    friendId);
            }
        }

        // Save PushDelivered flag updates
        if (pushNewFriendIds.Count > 0 || pushRetryFriendIds.Count > 0)
        {
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // PushDelivered flag is best-effort — a missed update means an extra push on redelivery
                logger.LogWarning(ex, "Failed to save PushDelivered flag updates — push may be retried on redelivery");
            }
        }
    }

    private static (string Title, string Body) BuildPushText(HabitCompletedEvent data)
    {
        var friendName = data.DisplayName ?? "A friend";
        var habitName = data.HabitName;

        var title = habitName is not null
            ? $"{friendName} completed {habitName}!"
            : $"{friendName} completed a habit!";

        var body = habitName is not null
            ? $"{friendName} just completed {habitName}"
            : $"{friendName} just completed a habit";

        return (title, body);
    }

    private sealed record FriendsResponse(List<Guid> FriendIds);
}
