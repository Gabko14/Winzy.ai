using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using WebPush;
using Winzy.NotificationService.Data;
using Winzy.NotificationService.Entities;

namespace Winzy.NotificationService.Services;

/// <summary>
/// Delivers push notifications to registered devices.
/// Uses the Web Push protocol with VAPID signing and RFC 8291/8188 payload encryption.
/// Expo push is stubbed for when native apps ship.
/// </summary>
public sealed class PushDeliveryService(
    IConfiguration configuration,
    ILogger<PushDeliveryService> logger)
{
    /// <summary>
    /// Attempt to deliver a push notification to all of a user's registered devices.
    /// Best-effort: logs failures but does not throw.
    /// </summary>
    public async Task DeliverAsync(
        NotificationDbContext db,
        Guid userId,
        string title,
        string body,
        string? url = null,
        CancellationToken ct = default)
    {
        var tokens = await db.DeviceTokens
            .Where(t => t.UserId == userId)
            .ToListAsync(ct);

        if (tokens.Count == 0)
        {
            logger.LogDebug("No device tokens for UserId={UserId}, skipping push delivery", userId);
            return;
        }

        var expiredTokenIds = new List<Guid>();

        foreach (var token in tokens)
        {
            var success = token.Platform switch
            {
                "web_push" => await DeliverWebPushAsync(token, title, body, url, ct),
                "expo_push" => DeliverExpoPush(token, title, body),
                _ => LogUnknownPlatform(token)
            };

            if (!success)
            {
                expiredTokenIds.Add(token.Id);
            }
        }

        // Clean up expired/invalid tokens
        if (expiredTokenIds.Count > 0)
        {
            await db.DeviceTokens
                .Where(t => expiredTokenIds.Contains(t.Id))
                .ExecuteDeleteAsync(ct);

            logger.LogInformation(
                "Removed {Count} expired/invalid device tokens for UserId={UserId}",
                expiredTokenIds.Count, userId);
        }
    }

    private async Task<bool> DeliverWebPushAsync(
        DeviceToken token, string title, string body, string? url, CancellationToken ct)
    {
        try
        {
            var subscription = JsonSerializer.Deserialize<WebPushSubscriptionDto>(token.Token,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (subscription?.Endpoint is null || subscription.Keys?.P256dh is null || subscription.Keys?.Auth is null)
            {
                logger.LogWarning("Invalid web push subscription for TokenId={TokenId}", token.Id);
                return false;
            }

            var vapidSubject = configuration["WebPush:Subject"] ?? "mailto:hello@winzy.ai";
            var vapidPublicKey = configuration["WebPush:PublicKey"];
            var vapidPrivateKey = configuration["WebPush:PrivateKey"];

            if (string.IsNullOrEmpty(vapidPublicKey) || string.IsNullOrEmpty(vapidPrivateKey))
            {
                logger.LogWarning("VAPID keys not configured — skipping web push delivery");
                return true; // Don't remove token, config issue not token issue
            }

            var payload = JsonSerializer.Serialize(new
            {
                title,
                body,
                url = url ?? "/",
                icon = "/assets/icon.png",
                badge = "/assets/favicon.png"
            });

            var pushSubscription = new PushSubscription(
                subscription.Endpoint,
                subscription.Keys.P256dh,
                subscription.Keys.Auth);

            var vapidDetails = new VapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

            var client = new WebPushClient();
            await client.SendNotificationAsync(pushSubscription, payload, vapidDetails, ct);

            logger.LogDebug("Web push delivered to TokenId={TokenId}", token.Id);
            return true;
        }
        catch (WebPushException ex) when (
            ex.StatusCode == System.Net.HttpStatusCode.NotFound ||
            ex.StatusCode == System.Net.HttpStatusCode.Gone)
        {
            logger.LogInformation(
                "Web push subscription expired (HTTP {Status}) for TokenId={TokenId}",
                (int)ex.StatusCode, token.Id);
            return false;
        }
        catch (WebPushException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            logger.LogWarning("Web push rate limited for TokenId={TokenId}", token.Id);
            return true; // Keep token, rate limited
        }
        catch (WebPushException ex)
        {
            logger.LogWarning(
                "Web push delivery failed (HTTP {Status}) for TokenId={TokenId}: {Message}",
                (int)ex.StatusCode, token.Id, ex.Message);
            return true; // Keep token for transient errors
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Web push delivery error for TokenId={TokenId}", token.Id);
            return true; // Keep token on transient errors
        }
    }

    private bool DeliverExpoPush(DeviceToken token, string title, string body)
    {
        // Expo push delivery is not yet implemented — native apps haven't shipped.
        // When ready, integrate with Expo Push API: https://docs.expo.dev/push-notifications/
        // Parameters (title, body) will be used when Expo Push integration is added.
        _ = (title, body);
        logger.LogInformation(
            "Expo push delivery not yet implemented — skipping TokenId={TokenId}", token.Id);
        return true;
    }

    private bool LogUnknownPlatform(DeviceToken token)
    {
        logger.LogWarning("Unknown device platform '{Platform}' for TokenId={TokenId}", token.Platform, token.Id);
        return true;
    }

    private sealed record WebPushSubscriptionDto(string? Endpoint, WebPushKeysDto? Keys);
    private sealed record WebPushKeysDto(string? P256dh, string? Auth);
}
