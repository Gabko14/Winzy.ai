using Microsoft.Extensions.Hosting;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;
using NATS.Client.Serializers.Json;

namespace Winzy.Common.Messaging;

public abstract class NatsEventSubscriber<T>(INatsConnection connection, string stream, string consumer)
    : BackgroundService
{
    private readonly NatsJSContext _js = new(connection);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var consumerObj = await _js.CreateOrUpdateConsumerAsync(
            stream,
            new ConsumerConfig(consumer),
            stoppingToken);

        await foreach (var msg in consumerObj.ConsumeAsync<T>(
            serializer: NatsJsonSerializer<T>.Default,
            cancellationToken: stoppingToken))
        {
            await HandleAsync(msg.Data!, stoppingToken);
            await msg.AckAsync(cancellationToken: stoppingToken);
        }
    }

    protected abstract Task HandleAsync(T data, CancellationToken ct);
}
