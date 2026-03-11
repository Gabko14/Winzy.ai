using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.Serializers.Json;
using Winzy.Common.Observability;

namespace Winzy.Common.Messaging;

public sealed class NatsEventPublisher(INatsConnection connection)
{
    private readonly NatsJSContext _js = new(connection);

    public async Task PublishAsync<T>(string subject, T data, CancellationToken ct = default)
    {
        var headers = new NatsHeaders();

        var correlationId = CorrelationContext.CorrelationId;
        if (!string.IsNullOrEmpty(correlationId))
            headers[CorrelationContext.HeaderName] = correlationId;

        var ack = await _js.PublishAsync(
            subject,
            data,
            serializer: NatsJsonSerializer<T>.Default,
            headers: headers,
            cancellationToken: ct);

        ack.EnsureSuccess();
    }
}
