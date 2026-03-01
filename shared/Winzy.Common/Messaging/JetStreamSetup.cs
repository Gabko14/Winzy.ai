using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using NATS.Client.JetStream;
using NATS.Client.JetStream.Models;

namespace Winzy.Common.Messaging;

/// <summary>
/// Creates required JetStream streams on application startup.
/// Uses CreateOrUpdateStreamAsync so the operation is idempotent.
/// </summary>
public sealed class JetStreamSetup(INatsConnection connection, ILogger<JetStreamSetup> logger)
    : IHostedService
{
    private static readonly StreamConfig[] _streams =
    [
        new() { Name = "USERS", Subjects = ["user.>"] },
        new() { Name = "HABITS", Subjects = ["habit.>"] },
        new() { Name = "FRIENDS", Subjects = ["friend.>"] },
        new() { Name = "CHALLENGES", Subjects = ["challenge.>"] },
    ];

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var js = new NatsJSContext(connection);

        foreach (var config in _streams)
        {
            await js.CreateOrUpdateStreamAsync(config, cancellationToken);
            logger.LogInformation("JetStream stream {Stream} ready", config.Name);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
