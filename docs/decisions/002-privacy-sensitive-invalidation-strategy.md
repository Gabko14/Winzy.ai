# ADR-002: Privacy-Sensitive Invalidation Strategy for Visibility and Friend Changes

**Status:** Accepted
**Date:** 2026-03-11
**Bead:** winzy.ai-3r2.2
**Unblocks:** winzy.ai-szy (Public Flame Page), winzy.ai-bdd (Social Service), winzy.ai-ssb (Activity Service), winzy.ai-uut (Activity Feed UI)

## Context

Multiple downstream surfaces display data that depends on Social Service state:

- **Public Flame Page** (`winzy.ai/@username`) shows habits filtered by `public` visibility.
- **Activity Feed** shows friend activity filtered by friendship status and per-habit visibility.
- **Future surfaces** (challenges, notifications) may reference visibility.

When a user changes a habit's visibility from `public` to `private`, or removes a friend, downstream consumers must stop showing that data. The question is: how quickly, and through what mechanism?

This decision defines the invalidation strategy with a strict privacy-first constraint: **stale data must never expose private information to unauthorized viewers.**

## Decision

### Privacy Boundary: The Hard Rule

**Zero acceptable staleness for privacy-reducing changes.** When visibility narrows (e.g., `public` -> `private`) or a friendship ends, affected data must be invisible to unauthorized viewers on their **next read**. There is no grace period. Caching convenience never overrides this.

The inverse is safe: if visibility widens (e.g., `private` -> `public`) or a friendship forms, a brief delay before the data appears is acceptable and expected.

### Invalidation Mechanism: Synchronous Re-check on Read + Events for Cleanup

We use a **hybrid approach**:

1. **Synchronous re-check on read** for privacy-sensitive surfaces (public flame page, activity feed). The serving service calls Social Service at read time to get current visibility/friendship state. No caching of visibility data in downstream services.
2. **NATS events for async cleanup** of denormalized or materialized data (activity feed entries, notification references). Events trigger background removal of stale entries that would otherwise accumulate.

This hybrid avoids the pitfalls of pure-event invalidation (race conditions, missed events = privacy leak) while keeping the event-driven cleanup for data hygiene.

### Surface-by-Surface Strategy

#### Public Flame Page (`/habits/public/{username}`)

**Mechanism: Synchronous re-check on every read.**

As defined in ADR-001, the Habit Service calls `GET /social/internal/visible-habits/{userId}?viewer=public` on every public flame page request. This call returns the current set of public habit IDs. No caching.

**Privacy guarantee:** A visibility change from `public` to `private` takes effect on the very next public flame page load. The Social Service updates its DB synchronously on `PUT /social/visibility/{habitId}`, so the internal endpoint immediately reflects the new state.

**Performance:** The public flame page is not a high-QPS endpoint. One internal HTTP call per request is acceptable. If this becomes a bottleneck later, we can add a short-lived cache (max 5 seconds) with explicit invalidation, but we do not build that now.

**Social Service down:** Return empty habits with `"degraded": true` (never leak data by falling back to unfiltered results).

#### Activity Feed (`/activity/feed`)

**Mechanism: Synchronous re-check on read + async event-driven cleanup.**

The Activity Service stores feed entries (denormalized events like "Alice completed her Morning Run habit"). These entries reference specific habits and users. The feed endpoint must filter entries based on current visibility and friendship state.

**Read path:**
```
Client -> Gateway -> Activity Service: GET /activity/feed
                     Activity Service: fetches raw feed entries from its DB
                     Activity Service: calls Social Service to get:
                       1. Current friends list for the viewer
                       2. Visible habit IDs for each friend (viewer-specific)
                     Activity Service: filters feed entries to only show:
                       - Entries from current friends
                       - Entries for habits visible to the viewer
                     Activity Service: returns filtered feed
```

**Social Service internal endpoint for friend-scoped visibility:**
```
GET /social/internal/visible-habits/{userId}?viewer={viewerUserId}
Response 200: { "habitIds": ["uuid1", "uuid2"] }
```

This endpoint checks:
1. Is `viewerUserId` a friend of `userId`? If not, return only `public` habit IDs.
2. If friends, return habit IDs with visibility `public` or `friends`.

**Storage model:** The Activity Service uses a **single-copy write model** — each feed event (e.g., "Alice completed Morning Run") is stored once, not fanned out per viewer. Filtering happens at read time: the feed endpoint fetches raw entries, then filters them against the viewer's current friendship and visibility state from Social Service. This means the source entries themselves are not viewer-specific.

**Async cleanup:** When Social Service publishes events for friend removal or visibility narrowing, the Activity Service subscribes and marks affected source entries as `hidden` (soft-delete). For `visibility.changed` to `private`, it marks all entries for that habit. For `friend.removed`, it marks entries for `friends`-visibility habits between the two users. This cleanup reduces the volume of entries the read-time filter must process — it is a **performance optimization**, not a privacy mechanism. The read-time filter against Social Service is the privacy gate. Even if cleanup events are delayed or missed, the read-time filter ensures no unauthorized data is returned.

**Social Service down:** The Activity Service returns an empty feed (not a partially filtered feed). Log warning.

#### Future Surfaces (Challenges, Notifications)

The same pattern applies:
- **Read-time re-check** against Social Service for any data that depends on visibility or friendship.
- **Async cleanup events** for denormalized stores.
- **Fail closed** (hide data) if Social Service is unreachable.

### New NATS Subjects and Events

Add to `Subjects.cs`:

```csharp
public const string VisibilityChanged = "visibility.changed";
public const string FriendRemoved = "friend.removed";
```

Add to `SocialEvents.cs`:

```csharp
public record VisibilityChangedEvent(
    Guid UserId,
    Guid HabitId,
    string OldVisibility,
    string NewVisibility);

// UserId1 and UserId2 ordering is arbitrary — both directions must be cleaned up.
// We use symmetric naming (matching FriendRequestAcceptedEvent) because friend
// removal revokes access equally for both sides. Consumers must handle both
// (userId1's habits hidden from userId2) AND (userId2's habits hidden from userId1).
public record FriendRemovedEvent(Guid UserId1, Guid UserId2);
```

Note: `VisibilityChangedEvent` is also defined in ADR-001. It serves double duty — Social Service publishes it both for the orchestration contract and for invalidation consumers.

### JetStream Configuration

The `VISIBILITY` stream (defined in ADR-001) captures `visibility.>` events. No new stream is needed for `friend.removed` — the existing `FRIENDS` stream is configured with subject `friend.>`, so it already captures any `friend.*` subject including this new one. The only change is adding the `friend.removed` constant to `Subjects.cs` and the `FriendRemovedEvent` record to `SocialEvents.cs`; JetStream routing works automatically via the existing wildcard.

**New consumers:**

| Consumer | Stream | Filter Subject | Service |
|----------|--------|---------------|---------|
| `activity-visibility-changed` | VISIBILITY | `visibility.changed` | Activity Service |
| `activity-friend-removed` | FRIENDS | `friend.removed` | Activity Service |

Future services (notification, challenge) add their own consumers on the same streams.

### Event Processing: What Subscribers Do

#### Activity Service handles `visibility.changed`

```
If newVisibility is MORE restrictive than oldVisibility:
  Soft-delete feed entries for this habitId where the viewer
  would no longer have access under the new visibility.

If newVisibility is LESS restrictive:
  No action needed — new entries will naturally appear, and the
  read-time filter will start including previously hidden entries.
```

"More restrictive" ordering: `public` > `friends` > `private`. A change from `public` to `friends` means non-friend viewers lose access. A change to `private` means everyone loses access.

#### Activity Service handles `friend.removed`

```
Soft-delete feed entries where:
  - The entry is about userId1's habit AND the viewer is userId2, OR
  - The entry is about userId2's habit AND the viewer is userId1
  AND the habit visibility is 'friends' (not 'public')
```

Public habits remain visible regardless of friendship status. Only `friends`-visibility habits are affected by friend removal.

### Acceptable Staleness Summary

| Change Type | Privacy Direction | Max Staleness | Mechanism |
|-------------|-------------------|---------------|-----------|
| Visibility: public -> private | Narrowing (privacy-critical) | **0 (next read)** | Synchronous re-check |
| Visibility: public -> friends | Narrowing (privacy-critical) | **0 (next read)** | Synchronous re-check |
| Visibility: friends -> private | Narrowing (privacy-critical) | **0 (next read)** | Synchronous re-check |
| Visibility: private -> public | Widening (safe) | Seconds (event propagation) | Async event + next read |
| Visibility: private -> friends | Widening (safe) | Seconds (event propagation) | Async event + next read |
| Friend removed | Narrowing (privacy-critical) | **0 (next read)** | Synchronous re-check |
| Friend added | Widening (safe) | Seconds (event propagation) | Async event + next read |

### Observability and Regression Detection

#### Structured Logging

Every privacy-sensitive read must log:

```
LogInformation("Visibility filter applied: UserId={UserId}, Viewer={Viewer}, " +
    "TotalHabits={Total}, VisibleHabits={Visible}, FilteredOut={Filtered}",
    userId, viewerType, total, visible, total - visible);
```

Every visibility change event must log:

```
LogInformation("Visibility changed: UserId={UserId}, HabitId={HabitId}, " +
    "Old={Old}, New={New}",
    evt.UserId, evt.HabitId, evt.OldVisibility, evt.NewVisibility);
```

#### Integration Test Requirements

Services that depend on this decision must include these test scenarios:

1. **Visibility narrowing is immediate:** Set habit to `public`, load public flame page (habit visible). Change to `private`, reload (habit gone). No cache artifacts.
2. **Friend removal is immediate:** User A and B are friends. A has a `friends`-visibility habit. B sees it in feed. Remove friendship. B's next feed load does not include the habit.
3. **Social Service down = fail closed:** Mock Social Service as unavailable. Verify public flame returns empty (not unfiltered). Verify activity feed returns empty (not unfiltered).
4. **Degraded flag is set:** When Social Service is down, verify the response includes `"degraded": true`.

#### Health Check Extension

Each service reports lag metrics for **its own** NATS consumers via its health endpoint. This lets operators detect event processing delays that could cause stale cleanup.

**Activity Service** health endpoint (owns the `activity-*` consumers):

```json
{
  "status": "Healthy",
  "nats": {
    "connected": true,
    "consumers": {
      "activity-visibility-changed": { "pending": 0, "lastProcessed": "2026-03-11T..." },
      "activity-friend-removed": { "pending": 0, "lastProcessed": "2026-03-11T..." }
    }
  }
}
```

**Social Service** reports its own consumers (e.g., `social-habit-created` for initializing visibility rows from ADR-001). The Gateway aggregates all service health checks, so operators see the full picture at `GET /health`.

### What This Decision Explicitly Does NOT Do

- **No caching layer.** We do not introduce Redis, CDN caching, or in-memory caches for visibility data. The current scale does not justify the complexity, and caching visibility data is inherently risky for privacy. This can be revisited when public flame pages exceed ~100 QPS.
- **No GDPR-specific handling.** User deletion is already handled by `user.deleted` cascading to all services. This decision covers visibility and friendship changes, not account deletion.
- **No real-time push invalidation.** We do not push visibility changes to connected clients via WebSocket. The client discovers changes on its next API call. Real-time push can be added later if needed.

## Consequences

- Every privacy-sensitive read path adds one synchronous call to Social Service. This is the cost of zero-staleness for narrowing changes.
- Activity Service must implement read-time filtering even though it also does async cleanup. The async cleanup is a performance optimization (smaller result sets to filter), not a substitute for the read-time check.
- New services that display visibility-sensitive data must follow this pattern: synchronous re-check on read, async cleanup via events, fail closed if Social is down. This decision serves as the template.
- The `FRIENDS` stream needs a new subject `friend.removed`. The `VISIBILITY` stream (from ADR-001) already covers `visibility.changed`.
