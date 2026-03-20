using System.Collections.Concurrent;
using System.Diagnostics.Metrics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;
using NATS.Client.Serializers.Json;
using Winzy.Common.Messaging;
using Winzy.Testing.Common.Fixtures;

namespace Winzy.Common.Tests;

public sealed class SuccessSubscriber(
    INatsConnection connection,
    string stream,
    string consumer,
    string filterSubject,
    ILogger<SuccessSubscriber> logger)
    : NatsEventSubscriber<TestEvent>(connection, stream, consumer, filterSubject, logger)
{
    private int _handledCount;
    public int HandledCount => Volatile.Read(ref _handledCount);

    protected override Task HandleAsync(TestEvent data, CancellationToken ct)
    {
        Interlocked.Increment(ref _handledCount);
        return Task.CompletedTask;
    }
}

public sealed class FailingSubscriber(
    INatsConnection connection,
    string stream,
    string consumer,
    string filterSubject,
    ILogger<FailingSubscriber> logger)
    : NatsEventSubscriber<TestEvent>(connection, stream, consumer, filterSubject, logger)
{
    private int _attemptCount;
    public int AttemptCount => Volatile.Read(ref _attemptCount);

    protected override Task HandleAsync(TestEvent data, CancellationToken ct)
    {
        Interlocked.Increment(ref _attemptCount);
        throw new InvalidOperationException("Simulated failure");
    }
}

public sealed class NatsEventSubscriberMetricsTests : IClassFixture<NatsFixture>
{
    private readonly NatsFixture _fixture;

    public NatsEventSubscriberMetricsTests(NatsFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task ProcessedCounter_IncrementedOnSuccessfulMessage()
    {
        var ct = TestContext.Current.CancellationToken;

        await using var connection = new NatsConnection(new NatsOpts { Url = _fixture.ConnectionUrl });
        await connection.ConnectAsync();

        var js = new NatsJSContext(connection);
        var streamName = $"METRICS_OK_{Guid.NewGuid():N}";
        var consumerName = $"test-ok-{Guid.NewGuid():N}";
        var subject = $"metrics.ok.{Guid.NewGuid():N}";

        await js.CreateOrUpdateStreamAsync(
            new StreamConfig { Name = streamName, Subjects = [$"{subject}"] }, ct);

        long processedCount = 0;
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == "Winzy.Messaging" &&
                instrument.Name == "messaging.messages.processed")
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) =>
        {
            foreach (var tag in tags)
            {
                if (tag.Key == "consumer" && (string?)tag.Value == consumerName)
                {
                    Interlocked.Add(ref processedCount, measurement);
                    break;
                }
            }
        });
        listener.Start();

        var logger = NullLoggerFactory.Instance.CreateLogger<SuccessSubscriber>();
        var subscriber = new SuccessSubscriber(connection, streamName, consumerName, subject, logger);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var subscriberTask = subscriber.StartAsync(cts.Token);
        await Task.Delay(500, ct);

        await js.PublishAsync(subject, new TestEvent("1", "ok"),
            serializer: NatsJsonSerializer<TestEvent>.Default, cancellationToken: ct);
        await js.PublishAsync(subject, new TestEvent("2", "ok"),
            serializer: NatsJsonSerializer<TestEvent>.Default, cancellationToken: ct);

        // Wait for processing
        await Task.Delay(2000, ct);

        await cts.CancelAsync();
        try
        { await subscriberTask; }
        catch (OperationCanceledException) { }


        Assert.Equal(2, subscriber.HandledCount);
        Assert.Equal(2, Interlocked.Read(ref processedCount));
    }

    [Fact]
    public async Task FailedCounter_IncrementedOnHandlerException()
    {
        var ct = TestContext.Current.CancellationToken;

        await using var connection = new NatsConnection(new NatsOpts { Url = _fixture.ConnectionUrl });
        await connection.ConnectAsync();

        var js = new NatsJSContext(connection);
        var streamName = $"METRICS_FAIL_{Guid.NewGuid():N}";
        var consumerName = $"test-fail-{Guid.NewGuid():N}";
        var subject = $"metrics.fail.{Guid.NewGuid():N}";

        await js.CreateOrUpdateStreamAsync(
            new StreamConfig { Name = streamName, Subjects = [$"{subject}"] }, ct);

        long failedCount = 0;
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == "Winzy.Messaging" &&
                instrument.Name == "messaging.messages.failed")
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) =>
        {
            foreach (var tag in tags)
            {
                if (tag.Key == "consumer" && (string?)tag.Value == consumerName)
                {
                    Interlocked.Add(ref failedCount, measurement);
                    break;
                }
            }
        });
        listener.Start();

        var logger = NullLoggerFactory.Instance.CreateLogger<FailingSubscriber>();
        var subscriber = new FailingSubscriber(connection, streamName, consumerName, subject, logger);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var subscriberTask = subscriber.StartAsync(cts.Token);
        await Task.Delay(500, ct);

        await js.PublishAsync(subject, new TestEvent("1", "fail"),
            serializer: NatsJsonSerializer<TestEvent>.Default, cancellationToken: ct);

        // Wait for first failure + NAK (5s delay means only first attempt within this window)
        await Task.Delay(2000, ct);

        await cts.CancelAsync();
        try
        { await subscriberTask; }
        catch (OperationCanceledException) { }


        Assert.True(subscriber.AttemptCount >= 1, "Subscriber should have attempted at least once");
        Assert.True(Interlocked.Read(ref failedCount) >= 1, "Failed counter should have been incremented at least once");
    }

    [Fact]
    public async Task ExhaustedCounter_NotIncrementedOnNonFinalAttempt()
    {
        var ct = TestContext.Current.CancellationToken;

        await using var connection = new NatsConnection(new NatsOpts { Url = _fixture.ConnectionUrl });
        await connection.ConnectAsync();

        var js = new NatsJSContext(connection);
        var streamName = $"METRICS_EXHAUST_{Guid.NewGuid():N}";
        var consumerName = $"test-exhaust-{Guid.NewGuid():N}";
        var subject = $"metrics.exhaust.{Guid.NewGuid():N}";

        await js.CreateOrUpdateStreamAsync(
            new StreamConfig { Name = streamName, Subjects = [$"{subject}"] }, ct);

        long exhaustedCount = 0;
        long failedCount = 0;
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == "Winzy.Messaging" &&
                (instrument.Name == "messaging.messages.exhausted" ||
                 instrument.Name == "messaging.messages.failed"))
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) =>
        {
            foreach (var tag in tags)
            {
                if (tag.Key == "consumer" && (string?)tag.Value == consumerName)
                {
                    if (instrument.Name == "messaging.messages.exhausted")
                        Interlocked.Add(ref exhaustedCount, measurement);
                    else if (instrument.Name == "messaging.messages.failed")
                        Interlocked.Add(ref failedCount, measurement);
                    break;
                }
            }
        });
        listener.Start();

        var logger = NullLoggerFactory.Instance.CreateLogger<FailingSubscriber>();
        var subscriber = new FailingSubscriber(connection, streamName, consumerName, subject, logger);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var subscriberTask = subscriber.StartAsync(cts.Token);
        await Task.Delay(500, ct);

        await js.PublishAsync(subject, new TestEvent("1", "exhaust"),
            serializer: NatsJsonSerializer<TestEvent>.Default, cancellationToken: ct);

        // Wait for first failure only (NumDelivered=1, well below MaxDeliveryAttempts=5)
        await Task.Delay(2000, ct);

        await cts.CancelAsync();
        try
        { await subscriberTask; }
        catch (OperationCanceledException) { }


        // First attempt should have failed
        Assert.True(Interlocked.Read(ref failedCount) >= 1,
            $"Expected at least 1 failure, got {Interlocked.Read(ref failedCount)}");

        // Exhaustion should NOT fire on early attempts (NumDelivered=1 < MaxDeliveryAttempts=5)
        Assert.Equal(0, Interlocked.Read(ref exhaustedCount));
    }

    [Fact]
    public async Task Counters_IncludeCorrectTags()
    {
        var ct = TestContext.Current.CancellationToken;

        await using var connection = new NatsConnection(new NatsOpts { Url = _fixture.ConnectionUrl });
        await connection.ConnectAsync();

        var js = new NatsJSContext(connection);
        var streamName = $"METRICS_TAGS_{Guid.NewGuid():N}";
        var consumerName = $"test-tags-{Guid.NewGuid():N}";
        var subject = $"metrics.tags.{Guid.NewGuid():N}";

        await js.CreateOrUpdateStreamAsync(
            new StreamConfig { Name = streamName, Subjects = [$"{subject}"] }, ct);

        var capturedTags = new ConcurrentBag<KeyValuePair<string, object?>>();
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == "Winzy.Messaging" &&
                instrument.Name == "messaging.messages.processed")
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) =>
        {
            foreach (var tag in tags)
            {
                if (tag.Key == "consumer" && (string?)tag.Value == consumerName)
                {
                    foreach (var t in tags)
                        capturedTags.Add(t);
                    break;
                }
            }
        });
        listener.Start();

        var logger = NullLoggerFactory.Instance.CreateLogger<SuccessSubscriber>();
        var subscriber = new SuccessSubscriber(connection, streamName, consumerName, subject, logger);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var subscriberTask = subscriber.StartAsync(cts.Token);
        await Task.Delay(500, ct);

        await js.PublishAsync(subject, new TestEvent("1", "tags"),
            serializer: NatsJsonSerializer<TestEvent>.Default, cancellationToken: ct);

        await Task.Delay(2000, ct);

        await cts.CancelAsync();
        try
        { await subscriberTask; }
        catch (OperationCanceledException) { }


        Assert.Contains(capturedTags, t => t.Key == "consumer" && (string?)t.Value == consumerName);
        Assert.Contains(capturedTags, t => t.Key == "stream" && (string?)t.Value == streamName);
    }
}
