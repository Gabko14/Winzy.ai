using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;
using NATS.Client.Serializers.Json;

namespace Winzy.Common.Messaging;

public abstract class NatsEventSubscriber<T>(
    INatsConnection connection,
    string stream,
    string consumer,
    ILogger logger)
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
            if (msg.Data is null)
            {
                logger.LogWarning("Received NATS message with null payload on {Stream}/{Consumer}, skipping",
                    stream, consumer);
                await msg.AckAsync(cancellationToken: stoppingToken);
                continue;
            }

            try
            {
                await HandleAsync(msg.Data, stoppingToken);
                await msg.AckAsync(cancellationToken: stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Error processing message on {Stream}/{Consumer}",
                    stream, consumer);
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
    }

    protected abstract Task HandleAsync(T data, CancellationToken ct);
}
