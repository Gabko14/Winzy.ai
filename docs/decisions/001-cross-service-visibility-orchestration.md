# ADR-001: Cross-Service Habit Visibility Save Orchestration

**Status:** Accepted
**Date:** 2026-03-11
**Bead:** winzy.ai-3r2.1
**Unblocks:** winzy.ai-3mk (Habit CRUD), winzy.ai-o84 (Per-habit visibility UI), winzy.ai-412 (Settings), winzy.ai-szy (Public Flame Page), winzy.ai-bdd (Social Service)

## Context

Winzy has two services that both deal with habit visibility:

- **Habit Service** owns habits, completions, and consistency calculations.
- **Social Service** owns visibility settings (who can see which habits) and friendships.

When a user creates or edits a habit, both services may need to write data. Today the Habit Service has no visibility concept — it stores habits and serves them. The public flame endpoint (`/habits/public/{username}`) currently returns all non-archived habits for a user with no visibility filtering.

This decision defines the exact cross-service write/read contract so that implementers of Habit CRUD, visibility settings, and the public flame page all follow one consistent pattern.

## Decision

### Ownership Boundaries

| Data | Owner | Storage |
|------|-------|---------|
| Habit (name, icon, color, frequency, completions) | Habit Service | `habit_service` DB |
| Habit visibility (per-habit: `public`, `friends`, `private`) | Social Service | `social_service` DB |
| Default visibility preference (user-level setting) | Social Service | `social_service` DB |
| Friendships | Social Service | `social_service` DB |

**Habit Service never stores visibility.** Social Service never stores habit metadata.

### Data Model: Social Service

```
habit_visibility table:
  user_id     UUID NOT NULL
  habit_id    UUID NOT NULL
  visibility  TEXT NOT NULL  -- 'public' | 'friends' | 'private'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (user_id, habit_id)

user_settings table:
  user_id              UUID PRIMARY KEY
  default_visibility   TEXT NOT NULL DEFAULT 'private'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Flow 1: Create Habit

The frontend sends `POST /habits` to the Habit Service (via Gateway). The Habit Service creates the habit and publishes `habit.created`. The Social Service subscribes to `habit.created` and initializes a visibility row using the user's default visibility preference.

```
Client -> Gateway -> Habit Service: POST /habits { name, icon, color, frequency }
                     Habit Service: saves habit to DB
                     Habit Service: publishes habit.created { userId, habitId, name }
                                    |
                     Social Service: subscribes to habit.created (JetStream consumer)
                     Social Service: looks up user_settings.default_visibility (defaults to 'private')
                     Social Service: INSERT INTO habit_visibility (user_id, habit_id, visibility)
```

**Key points:**
- The Habit Service response to the client does NOT include visibility. The client can assume `private` until it fetches visibility from Social.
- The frontend fetches visibility separately via `GET /social/visibility` after habit creation if it needs to display the visibility badge immediately.
- JetStream guarantees at-least-once delivery. The Social Service consumer must be idempotent: `INSERT ... ON CONFLICT (user_id, habit_id) DO NOTHING`.

**Failure mode:** If Social Service is down when `habit.created` fires, JetStream retains the message (HABITS stream). Social Service processes it when it comes back. The habit exists but has no visibility row temporarily. During this window, the habit is treated as `private` (see "Read Path" below).

### Flow 2: Edit Habit (Metadata Only)

`PUT /habits/{id}` updates name, icon, color, frequency. No visibility change. No cross-service interaction needed. Habit Service handles this entirely.

### Flow 3: Edit Habit Visibility

The frontend sends visibility changes to the **Social Service**, not the Habit Service.

```
Client -> Gateway -> Social Service: PUT /social/visibility/{habitId} { visibility: "friends" }
                     Social Service: validates userId owns the habit (calls Habit Service internal endpoint)
                     Social Service: UPSERT habit_visibility SET visibility = 'friends'
                     Social Service: publishes visibility.changed { userId, habitId, oldVisibility, newVisibility }
```

**Social Service endpoint:**
```
PUT /social/visibility/{habitId}
Headers: X-User-Id (set by Gateway)
Body: { "visibility": "public" | "friends" | "private" }
Response 200: { "habitId": "...", "visibility": "friends" }
Response 404: habit not found or not owned by user
```

**Ownership validation:** Social Service calls `GET /habits/user/{userId}` (internal, service-to-service) to verify the habit exists and belongs to the user. This endpoint is already implemented and blocked from external access by the Gateway's `InternalRouteBlockMiddleware`.

**Race condition:** If the client sends a visibility change immediately after creating a habit, the ownership check may fail because the Habit Service hasn't committed the habit yet. In this case, Social Service returns 404, and the client retries. The frontend should handle this by not offering the visibility control until the create response has returned.

### Flow 4: Batch Fetch Visibility

The frontend needs visibility for all habits at once (habit list screen).

```
GET /social/visibility
Headers: X-User-Id (set by Gateway)
Response 200: {
  "defaultVisibility": "private",
  "habits": [
    { "habitId": "...", "visibility": "public" },
    { "habitId": "...", "visibility": "friends" }
  ]
}
```

Habits without a visibility row are returned as the user's `defaultVisibility`. The Social Service does not need to call the Habit Service for this — it returns what it knows. The frontend merges this with the habit list from `GET /habits`.

### Flow 5: Update Default Visibility Preference

```
PUT /social/settings
Headers: X-User-Id (set by Gateway)
Body: { "defaultVisibility": "friends" }
Response 200: { "defaultVisibility": "friends" }
```

This only changes the default for **future** habits. It does NOT retroactively change existing habit visibility rows. The frontend should explain this to the user.

### Flow 6: Public Flame Page Read Path

`GET /habits/public/{username}` is the public endpoint. It currently returns all habits. With visibility, it must filter to only `public` habits.

**Approach: Habit Service calls Social Service at read time.**

```
Client -> Gateway -> Habit Service: GET /habits/public/{username}
                     Habit Service: resolves username -> userId (via AuthService, existing)
                     Habit Service: fetches habits from its DB
                     Habit Service: calls Social Service internal endpoint to get public habit IDs
                     Habit Service: filters habits to only those with public visibility
                     Habit Service: returns filtered list with consistency/flame data
```

**Social Service internal endpoint:**
```
GET /social/internal/visible-habits/{userId}?viewer=public
Response 200: { "habitIds": ["uuid1", "uuid2"] }
```

This endpoint returns habit IDs visible to the specified viewer type. For `viewer=public`, it returns habits with `visibility = 'public'`. For authenticated friend views (future), it would accept `viewer={viewerUserId}` and check friendship + visibility.

**Timeout:** The Habit Service `HttpClient` for the Social Service internal call must be configured with a **2-second timeout**. This matches the existing AuthService client pattern (`TimeSpan.FromSeconds(5)` in the current code, but visibility lookups are simpler queries and the public flame page is user-facing, so a tighter timeout is appropriate).

```csharp
builder.Services.AddHttpClient("SocialService", client =>
{
    var socialUrl = builder.Configuration["Services:SocialServiceUrl"] ?? "http://social-service:5003";
    client.BaseAddress = new Uri(socialUrl);
    client.Timeout = TimeSpan.FromSeconds(2);
});
```

**Failure mode:** If Social Service is unavailable or times out during a public flame page read:
- Return **no habits** (safe default — never leak private data).
- Log warning with correlation ID.
- Return HTTP 200 with empty habits array and a `"degraded": true` flag so the frontend can show "Unable to load flame data, try again later."

### Flow 7: Delete Habit

`DELETE /habits/{id}` soft-deletes the habit (sets `ArchivedAt`). No immediate cross-service call needed. The visibility row in Social Service becomes orphaned but harmless. Cleanup options:

1. **Lazy cleanup:** Social Service ignores visibility rows for habits that no longer appear in `GET /habits/user/{userId}` results. No extra work.
2. **Event-driven cleanup (recommended):** Add a `habit.archived` event. Social Service subscribes and deletes the visibility row. This keeps the Social DB clean.

### New NATS Subjects

Add to `Subjects.cs`:

```csharp
public const string HabitArchived = "habit.archived";
public const string VisibilityChanged = "visibility.changed";
```

### New NATS Events

Add to `SocialEvents.cs`:

```csharp
public record VisibilityChangedEvent(
    Guid UserId,
    Guid HabitId,
    string OldVisibility,
    string NewVisibility);
```

Add to `HabitEvents.cs`:

```csharp
public record HabitArchivedEvent(Guid UserId, Guid HabitId);
```

### New JetStream Stream

Add to `JetStreamSetup.cs`:

```csharp
new() { Name = "VISIBILITY", Subjects = ["visibility.>"] },
```

This follows the existing naming convention where the stream name matches the first segment of its subjects (USERS -> `user.>`, HABITS -> `habit.>`, FRIENDS -> `friend.>`, VISIBILITY -> `visibility.>`). This is a **new** stream being added alongside the existing four — it does not replace anything.

The existing `HABITS` stream already captures `habit.>` which covers `habit.archived`.

### Idempotency Requirements

| Operation | Idempotency Strategy |
|-----------|---------------------|
| Social handles `habit.created` | `INSERT ... ON CONFLICT DO NOTHING` |
| Social handles `habit.archived` | `DELETE WHERE user_id = X AND habit_id = Y` (no-op if already deleted) |
| Visibility UPSERT | Standard `ON CONFLICT DO UPDATE` |
| Habit Service retries on Social call failure | No retry on public flame read — return degraded. Social subscription retries are handled by JetStream redelivery (max 5 attempts, 5s delay). |

### What the Frontend Must Do

1. **Habit list screen:** Fetch `GET /habits` and `GET /social/visibility` in parallel. Merge client-side. If Social returns an error, show habits without visibility badges and a subtle "visibility unavailable" indicator.
2. **Create habit:** After `POST /habits` succeeds, the habit is `private` by default. If the user wants to set visibility immediately, use `PUT /social/visibility/{habitId}`. Don't block the success toast on this.
3. **Edit visibility:** `PUT /social/visibility/{habitId}`. Optimistic UI update. Revert on failure.
4. **Public flame page:** The server handles filtering. The frontend just renders what it gets.

### User-Visible Failure UX

| Scenario | User sees |
|----------|-----------|
| Habit created but Social Service down | Habit appears with "private" visibility. Visibility initializes when Social recovers. |
| Visibility change fails | Toast: "Couldn't update visibility. Try again." Visibility reverts to previous value. |
| Public flame page, Social Service down | Empty flame page with "Unable to load flame data right now." |
| Social Service slow (>2s) on public read | Habit Service times out the internal call, returns degraded response. |

## Consequences

- Habit creation remains a single synchronous call — no added latency for the user.
- Visibility is eventually consistent (async via NATS). The worst case is a brief window where a new habit has no visibility row, which defaults to `private` (safe).
- Public flame page adds one internal HTTP call to Social Service. This is acceptable for a public read path that is not latency-critical.
- Social Service becomes a required dependency for visibility-filtered reads but not for core habit CRUD.
