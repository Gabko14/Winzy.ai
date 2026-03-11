# Baseline Performance Expectations

> These thresholds define "acceptable" for a local Docker Compose stack.
> Production targets will differ based on hardware, network, and load profile.

## HTTP Gateway Load Test (k6, `gateway-http.js`)

Runs with relaxed auth rate limits (10000/min) so scenarios measure service
performance, not rate limiting. See "Rate Limit Strategy" below.

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Auth endpoints p95 latency | < 2000ms | Register/login involve DB writes + JWT generation |
| Habit CRUD p95 latency | < 1000ms | Authenticated requests through gateway + habit-service |
| Public endpoints p95 latency | < 500ms | No auth overhead, read-only |
| Auth error rate | < 5% | Register + login operations |
| Habit error rate | < 5% | Includes create, list, complete, stats |
| Public error rate | < 1% | Health + public flame page |
| Habit create p95 | < 1500ms | Custom metric for habit creation specifically |

### Scenario Details

**auth_public** (2 req/s for 30s)
- Registers a unique user, then logs in
- Tests the full auth flow including DB persistence and JWT minting

**habit_crud** (ramp 1-10 VUs over 45s)
- Each VU registers, then creates a habit, lists habits, completes a habit, and fetches stats
- Tests the authenticated request path: gateway JWT validation, X-User-Id injection, proxy to habit-service

**public_read** (10 constant VUs for 30s)
- Hits /health and /habits/public/{username} without authentication
- Tests unauthenticated gateway path and downstream health aggregation

## Rate Limit Validation (k6, `gateway-ratelimit.js`)

Runs against the gateway with **production** rate limits (10/min for auth endpoints).

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Rate limit 429 rate | > 20% | Auth rate limit (10/min) must actually trigger |

**rate_limit_probe** (15 rapid requests from 1 VU)
- Deliberately exceeds the 10/min auth rate limit
- Validates that the gateway returns 429 when the limit is breached

### Rate Limit Strategy

The gateway auth rate limit is 10/min per IP (`RateLimiting:AuthPermitLimit` in `Program.cs`
line 42). Since all k6 VUs share a single IP inside Docker, this limit causes cascading 429s
across all auth-heavy scenarios if left at production values.

`docker-compose.perf.yml` overrides the gateway with `RateLimiting__AuthPermitLimit=10000`
during load tests. This is NOT weakening security -- it's isolating what we're measuring:
- Load tests measure latency, throughput, and error rates under concurrent traffic
- Rate limit validation runs separately and verifies the limit works correctly

`run.sh` handles the gateway restart between phases automatically.

## NATS/JetStream (Node.js, `nats-load.js`)

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Publish p95 latency | < 50ms | JetStream ack'd publish per stream |
| Consume p95 latency | < 200ms | End-to-end publish-to-consume |
| Publish error rate | < 1% | Should be near-zero on healthy NATS |
| Message loss rate | < 2% | JetStream durability guarantee |
| NAK retry | redelivery occurs | Consumer NAK must trigger redelivery |

### Scenario Details

**Publish load** (100 messages per stream)
- Publishes to each of the 4 JetStream streams (USERS, HABITS, FRIENDS, CHALLENGES)
- Measures per-message publish latency including JetStream ack

**Consume load** (100 messages per stream)
- Creates an ephemeral consumer per stream and consumes all published messages
- Measures end-to-end latency (publish timestamp to consume time)

**NAK/retry**
- Publishes 1 message, NAKs the first delivery, verifies redelivery occurs
- Tests the retry behavior that services like UserDeletedSubscriber rely on

## Baseline Measurements

> **Pending** -- run `./perf/run.sh` against the full Docker Compose stack and record
> results here before merging. These numbers establish the reference point for detecting
> regressions in future runs.

### HTTP Gateway

| Metric | Value | Threshold |
|--------|-------|-----------|
| Auth p95 latency | _pending_ | < 2000ms |
| Habit CRUD p95 latency | _pending_ | < 1000ms |
| Habit create p95 latency | _pending_ | < 1500ms |
| Public p95 latency | _pending_ | < 500ms |
| Auth error rate | _pending_ | < 5% |
| Habit error rate | _pending_ | < 5% |
| Public error rate | _pending_ | < 1% |
| Rate limit 429 rate | _pending_ | > 20% |

### NATS/JetStream

| Metric | Value | Threshold |
|--------|-------|-----------|
| USERS publish p95 | _pending_ | < 50ms |
| HABITS publish p95 | _pending_ | < 50ms |
| FRIENDS publish p95 | _pending_ | < 50ms |
| CHALLENGES publish p95 | _pending_ | < 50ms |
| USERS consume p95 | _pending_ | < 200ms |
| HABITS consume p95 | _pending_ | < 200ms |
| FRIENDS consume p95 | _pending_ | < 200ms |
| CHALLENGES consume p95 | _pending_ | < 200ms |
| Publish error rate | _pending_ | < 1% |
| Message loss rate | _pending_ | < 2% |
| NAK retry success | _pending_ | redelivery occurs |

### Resource Usage

| Metric | Value |
|--------|-------|
| Docker CPU peak | _pending_ |
| Docker memory peak | _pending_ |
| Notable bottleneck | _pending_ |

## Environment

Baseline collected on:
- Docker Desktop for macOS
- 8 CPU cores, 16GB RAM allocated to Docker
- All services running in docker compose (gateway + 6 services + 6 Postgres + NATS)
- No external load during test

## When Thresholds Are Breached

1. Check if the breach is consistent (run 3x) or a one-off spike
2. Check docker stats for resource pressure (CPU, memory, I/O)
3. Check service logs for errors or slow queries
4. If the breach is real and consistent, open a follow-up bead with:
   - Which metric breached and by how much
   - Which service/path is the bottleneck
   - Proposed investigation or fix
