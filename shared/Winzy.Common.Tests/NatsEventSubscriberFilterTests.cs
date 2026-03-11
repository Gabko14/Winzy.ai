using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;
using NATS.Client.Serializers.Json;
using Winzy.Common.Messaging;
using Winzy.Testing.Common.Fixtures;

namespace Winzy.Common.Tests;

public sealed record TestEvent(string Id, string Type);

public sealed class TestSubscriber(
    INatsConnection connection,
    string stream,
    string consumer,
    string filterSubject,
    ILogger<TestSubscriber> logger)
    : NatsEventSubscriber<TestEvent>(connection, stream, consumer, filterSubject, logger)
{
    private readonly List<TestEvent> _handled = [];
    private readonly object _lock = new();

    public IReadOnlyList<TestEvent> Handled
    {
        get
        {
            lock (_lock)
            {
                return [.. _handled];
            }
        }
    }

    protected override Task HandleAsync(TestEvent data, CancellationToken ct)
    {
        lock (_lock)
        {
            _handled.Add(data);
        }

        return Task.CompletedTask;
    }
}

public sealed class NatsEventSubscriberFilterTests : IClassFixture<NatsFixture>
{
    private readonly NatsFixture _fixture;

    public NatsEventSubscriberFilterTests(NatsFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Subscriber_WithFilterSubject_OnlyReceivesMatchingMessages()
    {
        var ct = TestContext.Current.CancellationToken;

        await using var connection = new NatsConnection(new NatsOpts { Url = _fixture.ConnectionUrl });
        await connection.ConnectAsync();

        var js = new NatsJSContext(connection);
        await js.CreateOrUpdateStreamAsync(
            new StreamConfig { Name = "USERS", Subjects = ["user.>"] }, ct);

        var logger = NullLoggerFactory.Instance.CreateLogger<TestSubscriber>();
        var subscriber = new TestSubscriber(
            connection, "USERS", "test-deleted-consumer", "user.deleted", logger);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var subscriberTask = subscriber.StartAsync(cts.Token);

        // Give the consumer time to register
        await Task.Delay(500, ct);

        // Publish both user.registered and user.deleted messages
        await js.PublishAsync(
            "user.registered",
            new TestEvent("1", "registered"),
            serializer: NatsJsonSerializer<TestEvent>.Default,
            cancellationToken: ct);
        await js.PublishAsync(
            "user.deleted",
            new TestEvent("2", "deleted"),
            serializer: NatsJsonSerializer<TestEvent>.Default,
            cancellationToken: ct);
        await js.PublishAsync(
            "user.registered",
            new TestEvent("3", "registered"),
            serializer: NatsJsonSerializer<TestEvent>.Default,
            cancellationToken: ct);
        await js.PublishAsync(
            "user.deleted",
            new TestEvent("4", "deleted"),
            serializer: NatsJsonSerializer<TestEvent>.Default,
            cancellationToken: ct);

        // Wait for processing
        await Task.Delay(2000, ct);

        // Stop the subscriber
        await cts.CancelAsync();
        try
        {
            await subscriberTask;
        }
        catch (OperationCanceledException)
        {
            // Expected
        }

        // Only user.deleted messages should have been handled
        var handled = subscriber.Handled;
        Assert.Equal(2, handled.Count);
        Assert.All(handled, e => Assert.Equal("deleted", e.Type));
        Assert.Contains(handled, e => e.Id == "2");
        Assert.Contains(handled, e => e.Id == "4");
    }
}
