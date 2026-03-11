using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Winzy.Testing.Common.Assertions;

/// <summary>
/// Convenience wrappers for common EF Core database assertions.
/// </summary>
public static class DbAssertions
{
    /// <summary>
    /// Asserts that at least one entity of type <typeparamref name="T"/> matching the predicate exists.
    /// </summary>
    public static async Task AssertExists<T>(DbContext context, Expression<Func<T, bool>> predicate) where T : class
    {
        var exists = await context.Set<T>().AnyAsync(predicate);
        Assert.True(exists, $"Expected at least one {typeof(T).Name} matching predicate, but none found.");
    }

    /// <summary>
    /// Asserts that no entity of type <typeparamref name="T"/> matching the predicate exists.
    /// </summary>
    public static async Task AssertNotExists<T>(DbContext context, Expression<Func<T, bool>> predicate) where T : class
    {
        var exists = await context.Set<T>().AnyAsync(predicate);
        Assert.False(exists, $"Expected no {typeof(T).Name} matching predicate, but at least one was found.");
    }

    /// <summary>
    /// Asserts that the total count of entities of type <typeparamref name="T"/> equals <paramref name="expected"/>.
    /// </summary>
    public static async Task AssertCount<T>(DbContext context, int expected) where T : class
    {
        var actual = await context.Set<T>().CountAsync();
        Assert.Equal(expected, actual);
    }
}
