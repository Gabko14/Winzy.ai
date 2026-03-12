using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Winzy.NotificationService.Data;
using Winzy.NotificationService.Entities;

namespace Winzy.NotificationService.Services;

/// <summary>
/// Delivers push notifications to registered devices.
/// Currently supports Web Push (via the Web Push protocol).
/// Expo push is stubbed for when native apps ship.
/// </summary>
public sealed class PushDeliveryService(
    IHttpClientFactory httpClientFactory,
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
            var subscription = JsonSerializer.Deserialize<WebPushSubscription>(token.Token);
            if (subscription?.Endpoint is null)
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

            // Use the Web Push protocol via HttpClient
            // The actual VAPID signing and encryption would use a library like WebPush-NetCore.
            // For now we send a plain POST to the subscription endpoint.
            // In production, swap this with proper Web Push encryption (RFC 8291).
            var client = httpClientFactory.CreateClient("webpush");
            var request = new HttpRequestMessage(HttpMethod.Post, subscription.Endpoint)
            {
                Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json")
            };

            // Add TTL header (required by Web Push protocol)
            request.Headers.TryAddWithoutValidation("TTL", "86400");

            var response = await client.SendAsync(request, ct);

            if (response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.Created)
            {
                logger.LogDebug("Web push delivered to TokenId={TokenId}", token.Id);
                return true;
            }

            // 404 or 410 = subscription expired, remove it
            if (response.StatusCode is System.Net.HttpStatusCode.NotFound
                or System.Net.HttpStatusCode.Gone)
            {
                logger.LogInformation(
                    "Web push subscription expired (HTTP {Status}) for TokenId={TokenId}",
                    (int)response.StatusCode, token.Id);
                return false;
            }

            // 429 = rate limited, keep token
            if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                logger.LogWarning("Web push rate limited for TokenId={TokenId}", token.Id);
                return true;
            }

            logger.LogWarning(
                "Web push delivery failed (HTTP {Status}) for TokenId={TokenId}",
                (int)response.StatusCode, token.Id);
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

    private sealed record WebPushSubscription(string? Endpoint, WebPushKeys? Keys);
    private sealed record WebPushKeys(string? P256dh, string? Auth);
}
