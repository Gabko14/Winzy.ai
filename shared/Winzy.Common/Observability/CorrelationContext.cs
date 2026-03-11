namespace Winzy.Common.Observability;

/// <summary>
/// Ambient correlation ID accessible anywhere in the async call chain.
/// Set by CorrelationIdMiddleware for HTTP requests, and by NatsEventSubscriber for NATS messages.
/// Read by NatsEventPublisher to propagate correlation across service boundaries.
/// </summary>
public static class CorrelationContext
{
    private static readonly AsyncLocal<string?> _correlationId = new();

    public const string HeaderName = "X-Correlation-Id";

    public static string? CorrelationId
    {
        get => _correlationId.Value;
        set => _correlationId.Value = value;
    }
}
