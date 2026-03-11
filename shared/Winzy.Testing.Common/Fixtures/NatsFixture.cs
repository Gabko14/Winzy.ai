using Testcontainers.Nats;
using Xunit;

namespace Winzy.Testing.Common.Fixtures;

/// <summary>
/// xUnit fixture that starts a NATS container with JetStream enabled.
/// Shared across all tests in a class via IClassFixture&lt;NatsFixture&gt;.
/// </summary>
public sealed class NatsFixture : IAsyncLifetime
{
    private readonly NatsContainer _container = new NatsBuilder("nats:latest")
        .WithCommand("--jetstream")
        .Build();

    public string ConnectionUrl => _container.GetConnectionString();

    public ValueTask InitializeAsync()
        => new(_container.StartAsync());

    public ValueTask DisposeAsync()
        => new(_container.DisposeAsync().AsTask());
}
