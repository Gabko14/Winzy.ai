using Winzy.AuthService.Services;

namespace Winzy.AuthService.Tests.Unit;

public class ExportRateLimiterTests
{
    [Fact]
    public void TryAcquire_FirstRequest_Allowed()
    {
        var limiter = new ExportRateLimiter();
        var userId = Guid.NewGuid();

        Assert.True(limiter.TryAcquire(userId));
    }

    [Fact]
    public void TryAcquire_SecondRequestWithinWindow_Rejected()
    {
        var limiter = new ExportRateLimiter();
        var userId = Guid.NewGuid();

        Assert.True(limiter.TryAcquire(userId));
        Assert.False(limiter.TryAcquire(userId));
    }

    [Fact]
    public void TryAcquire_AfterWindowExpires_Allowed()
    {
        // Use a very short window so the test doesn't wait
        var limiter = new ExportRateLimiter(window: TimeSpan.FromMilliseconds(50));
        var userId = Guid.NewGuid();

        Assert.True(limiter.TryAcquire(userId));
        Assert.False(limiter.TryAcquire(userId));

        Thread.Sleep(100);

        Assert.True(limiter.TryAcquire(userId));
    }

    [Fact]
    public void TryAcquire_DifferentUsers_IndependentLimits()
    {
        var limiter = new ExportRateLimiter();
        var user1 = Guid.NewGuid();
        var user2 = Guid.NewGuid();

        Assert.True(limiter.TryAcquire(user1));
        Assert.True(limiter.TryAcquire(user2));

        // Both are now rate-limited independently
        Assert.False(limiter.TryAcquire(user1));
        Assert.False(limiter.TryAcquire(user2));
    }

    [Fact]
    public void TryAcquire_MultipleRejections_StillRejectsWithinWindow()
    {
        var limiter = new ExportRateLimiter();
        var userId = Guid.NewGuid();

        Assert.True(limiter.TryAcquire(userId));

        // Hammering the endpoint should keep returning false
        for (var i = 0; i < 10; i++)
            Assert.False(limiter.TryAcquire(userId));
    }

    [Fact]
    public void TryAcquire_ConcurrentFirstRequests_ExactlyOneSucceeds()
    {
        var limiter = new ExportRateLimiter();
        var userId = Guid.NewGuid();
        var results = new bool[20];
        var barrier = new Barrier(results.Length);

        var threads = Enumerable.Range(0, results.Length).Select(i =>
        {
            var t = new Thread(() =>
            {
                barrier.SignalAndWait();
                results[i] = limiter.TryAcquire(userId);
            });
            t.Start();
            return t;
        }).ToArray();

        foreach (var t in threads)
            t.Join();

        // Exactly one thread should have succeeded
        Assert.Equal(1, results.Count(r => r));
    }

    [Fact]
    public void TryAcquire_DefaultWindow_Is60Seconds()
    {
        // With the default 60s window, a second request immediately after should be rejected
        var limiter = new ExportRateLimiter();
        var userId = Guid.NewGuid();

        Assert.True(limiter.TryAcquire(userId));
        Assert.False(limiter.TryAcquire(userId));
    }

    [Fact]
    public void TryAcquire_CustomWindow_Respected()
    {
        var limiter = new ExportRateLimiter(window: TimeSpan.FromMilliseconds(1));
        var userId = Guid.NewGuid();

        Assert.True(limiter.TryAcquire(userId));
        Thread.Sleep(10);
        Assert.True(limiter.TryAcquire(userId));
    }
}
