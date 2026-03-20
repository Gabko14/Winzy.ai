using System.Diagnostics;
using System.Diagnostics.Metrics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;
using NATS.Client.Serializers.Json;
using Winzy.Common.Observability;

namespace Winzy.Common.Messaging;

internal static class MessagingMetrics
{
    internal static readonly Meter Meter = new("Winzy.Messaging");
    internal static readonly Counter<long> ProcessedCounter =
        Meter.CreateCounter<long>("messaging.messages.processed", description: "Messages processed successfully");
    internal static readonly Counter<long> FailedCounter =
        Meter.CreateCounter<long>("messaging.messages.failed", description: "Messages that failed processing");
    internal static readonly Counter<long> ExhaustedCounter =
        Meter.CreateCounter<long>("messaging.messages.exhausted", description: "Messages that exhausted all delivery attempts");
}

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

        var tags = new TagList { { "consumer", consumer }, { "stream", stream } };

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

                MessagingMetrics.ProcessedCounter.Add(1, tags);

                logger.LogInformation(
                    "NATS {Subject} processed OK by {Consumer} in {ElapsedMs}ms (attempt {Attempt}/{Max})",
                    filterSubject, consumer, stopwatch.ElapsedMilliseconds,
                    msg.Metadata?.NumDelivered ?? 1, MaxDeliveryAttempts);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                stopwatch.Stop();

                MessagingMetrics.FailedCounter.Add(1, tags);

                var attempt = msg.Metadata?.NumDelivered ?? 0;
                var isExhausted = attempt >= MaxDeliveryAttempts;

                if (isExhausted)
                {
                    MessagingMetrics.ExhaustedCounter.Add(1, tags);

                    logger.LogError(ex,
                        "NATS {Subject} EXHAUSTED in {Consumer} after {ElapsedMs}ms — all {Max} delivery attempts failed, message will be dropped: {Reason}",
                        filterSubject, consumer, stopwatch.ElapsedMilliseconds,
                        MaxDeliveryAttempts, ex.Message);

                    // ACK on final attempt — JetStream won't redeliver past MaxDeliver anyway,
                    // and NAK would just add unnecessary server-side work
                    await msg.AckAsync(cancellationToken: stoppingToken);
                }
                else
                {
                    logger.LogError(ex,
                        "NATS {Subject} FAILED in {Consumer} after {ElapsedMs}ms (attempt {Attempt}/{Max}): {Reason}",
                        filterSubject, consumer, stopwatch.ElapsedMilliseconds,
                        attempt, MaxDeliveryAttempts, ex.Message);

                    await msg.NakAsync(delay: TimeSpan.FromSeconds(5), cancellationToken: stoppingToken);
                }
            }
            finally
            {
                CorrelationContext.CorrelationId = null;
            }
        }
    }

    protected abstract Task HandleAsync(T data, CancellationToken ct);
}
