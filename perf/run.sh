#!/usr/bin/env bash
set -euo pipefail

# ── Winzy.ai Load/Performance Validation Runner ─────────────────────
#
# Runs the full perf suite against a local Docker Compose stack.
#
# The gateway auth rate limit is relaxed (10 -> 10000/min) during load
# tests via docker-compose.perf.yml so that auth-heavy scenarios don't
# get 429'd. Rate limit correctness is validated separately by the
# "ratelimit" mode, which runs against the production-configured gateway.
#
# Prerequisites:
#   - Docker Compose stack is running: docker compose up -d
#   - k6 installed locally (brew install k6) OR use Docker mode
#
# Usage:
#   ./perf/run.sh              # Run HTTP + NATS + rate limit tests
#   ./perf/run.sh http         # Run only HTTP gateway load tests
#   ./perf/run.sh nats         # Run only NATS load tests
#   ./perf/run.sh ratelimit    # Run only rate limit validation
#   ./perf/run.sh local        # Run k6 + node locally (requires k6 installed)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
PERF_COMPOSE="$SCRIPT_DIR/docker-compose.perf.yml"

MODE="${1:-all}"
EXIT_CODE=0

echo "=== Winzy.ai Performance Validation ==="
echo "Mode: $MODE"
echo ""

# Verify the stack is running
if ! docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | grep -q '"State":"running"'; then
  echo "WARNING: Docker Compose stack may not be fully running."
  echo "Start it with: docker compose up -d"
  echo ""
fi

run_http_docker() {
  echo "--- HTTP Gateway Load Test (k6 via Docker, relaxed rate limits) ---"
  # Start gateway with relaxed auth rate limit, run k6, then restart with normal limits
  docker compose -f "$COMPOSE_FILE" -f "$PERF_COMPOSE" up -d api-gateway
  echo "  Waiting for gateway to be ready with relaxed rate limits..."
  sleep 5
  docker compose -f "$COMPOSE_FILE" -f "$PERF_COMPOSE" run --rm k6-gateway || EXIT_CODE=1
  # Restore normal gateway config
  docker compose -f "$COMPOSE_FILE" up -d api-gateway
  sleep 3
  echo ""
}

run_http_local() {
  echo "--- HTTP Gateway Load Test (k6 local) ---"
  if ! command -v k6 &>/dev/null; then
    echo "ERROR: k6 not found. Install with: brew install k6"
    EXIT_CODE=1
    return
  fi
  GATEWAY_URL="${GATEWAY_URL:-http://localhost:5050}" k6 run "$SCRIPT_DIR/gateway-http.js" || EXIT_CODE=1
  echo ""
}

run_nats_docker() {
  echo "--- NATS/JetStream Load Test (Node via Docker) ---"
  docker compose -f "$COMPOSE_FILE" -f "$PERF_COMPOSE" run --rm nats-load || EXIT_CODE=1
  echo ""
}

run_nats_local() {
  echo "--- NATS/JetStream Load Test (Node local) ---"
  (cd "$SCRIPT_DIR" && npm install --silent && node nats-load.js) || EXIT_CODE=1
  echo ""
}

run_ratelimit_docker() {
  echo "--- Rate Limit Validation (k6 via Docker, production limits) ---"
  # Ensure gateway is running with production rate limits (no perf override)
  docker compose -f "$COMPOSE_FILE" up -d api-gateway
  sleep 3
  # Run rate limit probe using only the base compose (no relaxed limits).
  # Docker Compose prefixes network names with the project name, so we
  # resolve the actual name dynamically instead of hardcoding it.
  NETWORK=$(docker network ls --filter name=winzy-network --format '{{.Name}}' | head -1)
  if [ -z "$NETWORK" ]; then
    echo "ERROR: Could not find Docker network matching 'winzy-network'. Is the stack running?"
    EXIT_CODE=1
    return
  fi
  docker run --rm --network "$NETWORK" \
    -v "$SCRIPT_DIR:/scripts" \
    -e GATEWAY_URL=http://api-gateway:5000 \
    grafana/k6:latest run /scripts/gateway-ratelimit.js || EXIT_CODE=1
  echo ""
}

run_ratelimit_local() {
  echo "--- Rate Limit Validation (k6 local, production limits) ---"
  if ! command -v k6 &>/dev/null; then
    echo "ERROR: k6 not found. Install with: brew install k6"
    EXIT_CODE=1
    return
  fi
  GATEWAY_URL="${GATEWAY_URL:-http://localhost:5050}" k6 run "$SCRIPT_DIR/gateway-ratelimit.js" || EXIT_CODE=1
  echo ""
}

case "$MODE" in
  all)
    run_http_docker
    run_nats_docker
    run_ratelimit_docker
    ;;
  http)
    run_http_docker
    ;;
  nats)
    run_nats_docker
    ;;
  ratelimit)
    run_ratelimit_docker
    ;;
  local)
    run_http_local
    run_nats_local
    run_ratelimit_local
    ;;
  *)
    echo "Usage: $0 [all|http|nats|ratelimit|local]"
    exit 1
    ;;
esac

echo "=== Overall Result: $([ $EXIT_CODE -eq 0 ] && echo 'PASS' || echo 'FAIL') ==="
exit $EXIT_CODE
