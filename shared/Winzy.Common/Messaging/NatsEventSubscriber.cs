using System.Diagnostics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;
using NATS.Client.Serializers.Json;
using Winzy.Common.Observability;

namespace Winzy.Common.Messaging;

public abstract class NatsEventSubscriber<T>(
    INatsConnection connection,
    string stream,
    string consumer,
    string filterSubject,
    ILogger logger)
    : BackgroundService
{
    private readonly NatsJSContext _js = new(connection);

    private const int MaxDeliveryAttempts = 5;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var config = new ConsumerConfig(consumer)
        {
            FilterSubject = filterSubject,
            MaxDeliver = MaxDeliveryAttempts
        };

        var consumerObj = await _js.CreateOrUpdateConsumerAsync(
            stream,
            config,
            stoppingToken);

        logger.LogInformation("NATS subscriber started: {Stream}/{Consumer} filtering {Subject}",
            stream, consumer, filterSubject);

        await foreach (var msg in consumerObj.ConsumeAsync<T>(
            serializer: NatsJsonSerializer<T>.Default,
            cancellationToken: stoppingToken))
        {
            // Extract correlation ID from NATS headers if present
            string? headerValue = null;
            if (msg.Headers?.TryGetValue(CorrelationContext.HeaderName, out var values) == true)
                headerValue = values.ToString();
            var correlationId = headerValue ?? Guid.NewGuid().ToString("N");
            CorrelationContext.CorrelationId = correlationId;

            using var scope = logger.BeginScope(new Dictionary<string, object>
            {
                ["CorrelationId"] = correlationId,
                ["NatsSubject"] = filterSubject,
                ["NatsConsumer"] = consumer
            });

            if (msg.Data is null)
            {
                logger.LogWarning("Received NATS message with null payload on {Stream}/{Consumer}, skipping",
                    stream, consumer);
                await msg.AckAsync(cancellationToken: stoppingToken);
                CorrelationContext.CorrelationId = null;
                continue;
            }

            var stopwatch = Stopwatch.StartNew();

            try
            {
                await HandleAsync(msg.Data, stoppingToken);
                await msg.AckAsync(cancellationToken: stoppingToken);
                stopwatch.Stop();

                logger.LogInformation(
                    "NATS {Subject} processed OK by {Consumer} in {ElapsedMs}ms (attempt {Attempt}/{Max})",
                    filterSubject, consumer, stopwatch.ElapsedMilliseconds,
                    msg.Metadata?.NumDelivered ?? 1, MaxDeliveryAttempts);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                stopwatch.Stop();

                logger.LogError(ex,
                    "NATS {Subject} FAILED in {Consumer} after {ElapsedMs}ms (attempt {Attempt}/{Max}): {Reason}",
                    filterSubject, consumer, stopwatch.ElapsedMilliseconds,
                    msg.Metadata?.NumDelivered ?? 0, MaxDeliveryAttempts, ex.Message);

                await msg.NakAsync(delay: TimeSpan.FromSeconds(5), cancellationToken: stoppingToken);
            }
            finally
            {
                CorrelationContext.CorrelationId = null;
            }
        }
    }

    protected abstract Task HandleAsync(T data, CancellationToken ct);
}
