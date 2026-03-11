using System.Linq.Expressions;
using Xunit;

namespace Winzy.Testing.Common.Assertions;

/// <summary>
/// Convenience wrappers for asserting NATS event publication.
/// </summary>
public static class NatsAssertions
{
    /// <summary>
    /// Asserts that at least one event in <paramref name="received"/> matches the predicate.
    /// </summary>
    public static void AssertPublished<T>(List<T> received, Expression<Func<T, bool>> predicate)
    {
        var compiled = predicate.Compile();
        var match = received.Any(compiled);
        Assert.True(match, $"Expected at least one {typeof(T).Name} event matching predicate, but none found in {received.Count} received events.");
    }
}
