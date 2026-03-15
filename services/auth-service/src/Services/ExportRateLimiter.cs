using System.Collections.Concurrent;

namespace Winzy.AuthService.Services;

public class ExportRateLimiter
{
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> _lastExportTime = new();
    private readonly TimeSpan _window;
    private DateTimeOffset _lastScavenge = DateTimeOffset.UtcNow;
    private readonly TimeSpan _scavengeInterval = TimeSpan.FromMinutes(10);

    public ExportRateLimiter(TimeSpan? window = null)
    {
        _window = window ?? TimeSpan.FromSeconds(60);
    }

    /// <summary>
    /// Returns true if the request is allowed, false if rate-limited.
    /// </summary>
    public bool TryAcquire(Guid userId)
    {
        var now = DateTimeOffset.UtcNow;
        Scavenge(now);

        while (true)
        {
            if (_lastExportTime.TryGetValue(userId, out var lastTime))
            {
                if (now - lastTime < _window)
                    return false;

                // Window expired — try to update atomically
                if (_lastExportTime.TryUpdate(userId, now, lastTime))
                    return true;

                // Another thread updated it — retry
                continue;
            }

            // First request from this user
            if (_lastExportTime.TryAdd(userId, now))
                return true;

            // Another thread added it — retry
        }
    }

    /// <summary>
    /// Removes expired entries to prevent unbounded memory growth.
    /// Runs at most once per scavenge interval, piggy-backed on normal requests.
    /// </summary>
    private void Scavenge(DateTimeOffset now)
    {
        if (now - _lastScavenge < _scavengeInterval)
            return;

        _lastScavenge = now;

        foreach (var kvp in _lastExportTime)
        {
            if (now - kvp.Value >= _window)
                ((ICollection<KeyValuePair<Guid, DateTimeOffset>>)_lastExportTime).Remove(kvp);
        }
    }
}
