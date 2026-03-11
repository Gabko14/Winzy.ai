# Per-Service Export Contracts

> Decision record for winzy.ai-7qa.1. Defines what each service exports for
> bundled account export and how each service proves deletion completed.

## Context

Account export (GDPR data portability) and account deletion cascade across
all services. The orchestrator (winzy.ai-7dh) needs concrete contracts so it
can aggregate export payloads and verify deletion completed without reaching
into each service's internals.

## Export Payload Ownership

Each service exposes a **GET /internal/export/{userId}** endpoint (service-to-service
only, behind the gateway). The orchestrator calls each, aggregates the JSON
objects into a single download.

### Auth Service

Owns: user identity and profile data.

```json
{
  "service": "auth",
  "data": {
    "userId": "uuid",
    "email": "string",
    "username": "string",
    "displayName": "string | null",
    "avatarUrl": "string | null",
    "createdAt": "ISO-8601",
    "lastLoginAt": "ISO-8601 | null"
  }
}
```

Excluded from export:
- `passwordHash` — security-sensitive, never exported.
- `refreshTokens` — session artifacts, not user data.

### Habit Service

Owns: habits and completion history.

```json
{
  "service": "habit",
  "data": {
    "habits": [
      {
        "habitId": "uuid",
        "name": "string",
        "icon": "string | null",
        "color": "string | null",
        "frequency": "Daily | Weekly | Custom",
        "customDays": ["Monday", "..."] ,
        "archivedAt": "ISO-8601 | null",
        "createdAt": "ISO-8601",
        "completions": [
          {
            "completionId": "uuid",
            "completedAt": "ISO-8601",
            "localDate": "YYYY-MM-DD",
            "note": "string | null"
          }
        ]
      }
    ]
  }
}
```

### Social Service

Owns: friendships and friend requests.

> Social service entities are not yet implemented (Program.cs is a stub).
> The contract below is based on the NATS events already defined
> (`FriendRequestSentEvent`, `FriendRequestAcceptedEvent`).

```json
{
  "service": "social",
  "data": {
    "friends": [
      {
        "friendUserId": "uuid",
        "friendUsername": "string",
        "connectedAt": "ISO-8601"
      }
    ],
    "pendingRequests": [
      {
        "direction": "sent | received",
        "otherUserId": "uuid",
        "requestedAt": "ISO-8601"
      }
    ]
  }
}
```

### Challenge Service

Owns: challenges between friends.

> Challenge service entities are not yet implemented (Program.cs is a stub).
> The contract below is based on NATS events (`ChallengeCreatedEvent`,
> `ChallengeCompletedEvent`).

```json
{
  "service": "challenge",
  "data": {
    "challenges": [
      {
        "challengeId": "uuid",
        "fromUserId": "uuid",
        "toUserId": "uuid",
        "habitId": "uuid",
        "reward": "string | null",
        "status": "pending | accepted | completed | declined",
        "createdAt": "ISO-8601",
        "completedAt": "ISO-8601 | null"
      }
    ]
  }
}
```

### Notification Service

Owns: notification records and user notification preferences.

**Decision: Include notification settings. Exclude notification history.**

Rationale: Notification records are derived/transient data generated from
events in other services (habit completions, friend requests, challenges).
The source-of-truth data is already exported by those services. Exporting
thousands of "X completed a habit" notifications adds noise without value.
However, notification *settings* represent the user's explicit preferences
and are included.

```json
{
  "service": "notification",
  "data": {
    "settings": {
      "habitReminders": true,
      "friendActivity": true,
      "challengeUpdates": true
    }
  }
}
```

### Activity Service

**Decision: Exclude from export.**

The activity service is a stub with no entities. If it materializes as a
read-model or aggregation layer over other services' events, it holds no
original user data and should not export anything.

## Deletion Evidence

When `user.deleted` is published on NATS, each service with a JetStream
consumer must:

1. Delete all rows owned by that userId.
2. Log a structured deletion-evidence entry at `Information` level.
3. Ack the message only after successful deletion.

### Per-Service Deletion Log Contract

Each service logs with these structured fields on successful cleanup:

| Field | Type | Description |
|-------|------|-------------|
| `EventName` | string | `"UserDataDeleted"` |
| `Service` | string | Service name (e.g., `"habit-service"`) |
| `UserId` | Guid | The deleted user's ID |
| `DeletedCounts` | object | Per-table row counts deleted |
| `DurationMs` | long | Time taken for the deletion |

Example (already partially implemented in habit-service and notification-service):
```
UserDataDeleted Service=habit-service UserId=abc-123
  DeletedCounts={habits: 5, completions: 42} DurationMs=23
```

### Services That Must Handle user.deleted

| Service | Consumer Name | Tables Cleaned | Status |
|---------|--------------|----------------|--------|
| Habit | `habit-service-user-deleted` | habits, completions | Implemented |
| Notification | `notification-service-user-deleted` | notifications, notification_settings | Implemented |
| Social | `social-service-user-deleted` | friendships, friend_requests | Not yet (stub) |
| Challenge | `challenge-service-user-deleted` | challenges | Not yet (stub) |
| Activity | `activity-service-user-deleted` | (none currently) | Not yet (stub) |

Auth service handles its own deletion inline in the `DELETE /auth/account`
endpoint (deletes user + cascade-deletes refresh tokens via FK).

### Partial-Failure Diagnostics

The orchestrator should track deletion status per service:

1. **NATS JetStream guarantees at-least-once delivery.** If a service is down,
   the message stays in the stream until the consumer acks it.
2. **Timeout-based detection:** The orchestrator publishes `user.deleted` and
   then polls each service's health endpoint. If a service was down during
   the window, the operator is alerted that redelivery is pending.
3. **Deletion verification endpoint (future):** Each service can expose
   `GET /internal/deletion-status/{userId}` returning `{ "deleted": true/false }`.
   The orchestrator can call these to confirm cleanup across all services.
   This is not needed for MVP but provides deterministic verification.

### Failure Modes and Operator Actions

| Failure | Symptom | Resolution |
|---------|---------|------------|
| Service down during deletion | Health check fails, NATS message unacked | Automatic: JetStream redelivers when service reconnects |
| DB write fails mid-deletion | Subscriber throws, message not acked | Automatic: JetStream redelivers; deletion is idempotent (delete-where is safe to re-run) |
| NATS itself down | `DELETE /auth/account` fails before local deletion | User sees error, retries. No data deleted anywhere (safe direction). |
| Partial table cleanup | Logged counts don't match expected | Manual investigation via structured logs |

## Open Questions

- Should export include archived habits or only active ones? Current contract
  includes all (archived + active) since this is the user's data.
- Challenge export: include challenges where the user is either sender or
  receiver? Current contract assumes yes (both directions).
