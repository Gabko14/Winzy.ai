using Microsoft.Extensions.Diagnostics.HealthChecks;
using NATS.Client.Core;

namespace Winzy.Common.Health;

public sealed class NatsHealthCheck(INatsConnection connection) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var rtt = await connection.PingAsync(cancellationToken);
            return HealthCheckResult.Healthy($"NATS connected (RTT: {rtt.TotalMilliseconds:F1}ms)");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("NATS connection failed", ex);
        }
    }
}
