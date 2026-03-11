using Testcontainers.PostgreSql;
using Xunit;

namespace Winzy.Testing.Common.Fixtures;

/// <summary>
/// xUnit fixture that starts a PostgreSQL container.
/// Shared across all tests in a class via IClassFixture&lt;PostgresFixture&gt;.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("test_db")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    public string ConnectionString => _container.GetConnectionString();

    public ValueTask InitializeAsync()
        => new(_container.StartAsync());

    public ValueTask DisposeAsync()
        => new(_container.DisposeAsync().AsTask());
}
