using Microsoft.Extensions.Diagnostics.HealthChecks;
using NATS.Client.Core;

namespace Winzy.Common.Health;

public sealed class NatsHealthCheck(INatsConnection? connection = null) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        if (connection is null)
        {
            return HealthCheckResult.Unhealthy(
                "NATS not configured: INatsConnection is not registered. Call AddNatsMessaging() before AddNatsHealthCheck().");
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(5));
            var rtt = await connection.PingAsync(cts.Token);
            return HealthCheckResult.Healthy($"NATS connected (RTT: {rtt.TotalMilliseconds:F1}ms)");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("NATS connection failed", ex);
        }
    }
}
