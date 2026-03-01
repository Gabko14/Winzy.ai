using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.Serializers.Json;

namespace Winzy.Common.Messaging;

public sealed class NatsEventPublisher(INatsConnection connection)
{
    private readonly NatsJSContext _js = new(connection);

    public async Task PublishAsync<T>(string subject, T data, CancellationToken ct = default)
    {
        var ack = await _js.PublishAsync(
            subject,
            data,
            serializer: NatsJsonSerializer<T>.Default,
            cancellationToken: ct);

        ack.EnsureSuccess();
    }
}
