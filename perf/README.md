# Performance Validation

Repeatable load and performance tests for the Winzy.ai gateway HTTP paths and NATS/JetStream messaging paths.

## Tooling

- **HTTP load tests**: [k6](https://k6.io/) (JavaScript-based, lightweight, CI-friendly, native thresholds)
- **NATS/JetStream load tests**: Node.js with the [`nats`](https://www.npmjs.com/package/nats) v2 package (k6 has no native NATS support)
- **Orchestration**: Shell script + Docker Compose override

## Prerequisites

- Docker Compose stack running: `docker compose up -d`
- For local runs: [k6](https://k6.io/) (`brew install k6`) and Node.js 20+
- For NATS local runs: `cd perf && npm install` (installs the `nats` package)

## Quick Start

```bash
# Run everything via Docker (recommended)
./perf/run.sh

# Run only HTTP gateway load tests (with relaxed rate limits)
./perf/run.sh http

# Run only NATS/JetStream load tests
./perf/run.sh nats

# Run only rate limit validation (production limits)
./perf/run.sh ratelimit

# Run locally (requires k6 + node installed)
./perf/run.sh local
```

## What Gets Tested

### HTTP Gateway Load (`gateway-http.js`)

Runs with relaxed auth rate limits (10000/min) via `docker-compose.perf.yml` so that
auth-heavy scenarios measure latency/throughput, not rate limiting.

| Scenario | What it does | Load profile |
|----------|-------------|--------------|
| `auth_public` | Register + login | 2 req/s for 30s |
| `habit_crud` | Create, list, complete, stats (authenticated) | Ramp 1-10 VUs over 45s |
| `public_read` | Health check + public flame page | 10 VUs for 30s |

### Rate Limit Validation (`gateway-ratelimit.js`)

Runs against the gateway with **production** rate limits (10/min for auth endpoints).

| Scenario | What it does | Load profile |
|----------|-------------|--------------|
| `rate_limit_probe` | Burst auth endpoint to verify 429s | 15 rapid requests from 1 VU |

### NATS/JetStream (`nats-load.js`)

| Scenario | What it does | Load profile |
|----------|-------------|--------------|
| Publish load | Publish 100 msgs to each of 4 streams | Sequential per stream |
| Consume load | Consume all published msgs via ephemeral consumers | Sequential per stream |
| NAK/retry | Verify consumer redelivery on NAK | 1 message, 2 deliveries |

## Pass/Fail Thresholds

See [baseline-results.md](baseline-results.md) for detailed thresholds and expectations.

**Key thresholds:**
- HTTP auth p95 < 2000ms, habit CRUD p95 < 1000ms, public p95 < 500ms
- NATS publish p95 < 50ms, consume p95 < 200ms
- Error rates < 5% (auth/habit), < 1% (public/NATS)
- Rate limiting must trigger (>20% of probe requests get 429)

## Rate Limit Strategy

The gateway has an auth rate limit of 10/min per IP (`RateLimiting:AuthPermitLimit` in `Program.cs`).
Since all k6 VUs share a single IP, this limit would cause cascading 429s across all auth-heavy scenarios,
making the load test measure rate limiting instead of actual service performance.

**Solution:** `docker-compose.perf.yml` overrides the gateway with `RateLimiting__AuthPermitLimit=10000`
during load tests. Rate limit correctness is validated separately by `gateway-ratelimit.js`, which runs
against the gateway with production limits. The `run.sh` script handles the gateway restart automatically.

## Running via Docker Compose

```bash
# Start the stack
docker compose up -d

# Run HTTP load tests (with relaxed rate limits)
docker compose -f docker-compose.yml -f perf/docker-compose.perf.yml up -d api-gateway
docker compose -f docker-compose.yml -f perf/docker-compose.perf.yml run --rm k6-gateway

# Run NATS tests
docker compose -f docker-compose.yml -f perf/docker-compose.perf.yml run --rm nats-load

# Run rate limit validation (production limits)
docker compose up -d api-gateway  # restore normal config
# Resolve the compose-prefixed network name dynamically
NETWORK=$(docker network ls --filter name=winzy-network --format '{{.Name}}' | head -1)
docker run --rm --network "$NETWORK" \
  -v ./perf:/scripts \
  -e GATEWAY_URL=http://api-gateway:5000 \
  grafana/k6:latest run /scripts/gateway-ratelimit.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://localhost:5050` | Gateway URL (local) or `http://api-gateway:5000` (Docker) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `NATS_MSG_COUNT` | `100` | Messages per stream for NATS load test |
| `NATS_CONSUMER_TIMEOUT` | `10000` | Consumer timeout in ms |

## Interpreting Results

### k6 Output

k6 prints a summary with all metrics. Look for:
- `checks` -- percentage of assertions that passed
- `http_req_duration` -- request latency percentiles
- `http_req_failed` -- error rate
- Custom metrics (`auth_error_rate`, `habit_error_rate`, etc.)
- Threshold status: green checkmarks = pass, red crosses = fail

### NATS Output

The Node.js script prints per-stream results with latency stats and a final PASS/FAIL.

## CI Integration

All tests exit with code 0 (pass) or 1 (fail), making them suitable for CI pipelines:

```yaml
# GitHub Actions example
- name: Run perf tests
  run: |
    docker compose up -d
    # Wait for services to be healthy
    sleep 30
    ./perf/run.sh
```

## When Tests Fail

1. Run 3x to distinguish flakes from real regressions
2. Check `docker stats` for resource pressure
3. Check service logs: `docker compose logs <service>`
4. See [baseline-results.md](baseline-results.md) for follow-up procedure
