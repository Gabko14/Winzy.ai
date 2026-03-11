// Gateway rate limit validation — k6
//
// Verifies that the gateway auth rate limit (10/min per IP) actually triggers.
// Must run against the gateway with PRODUCTION rate limits (not the relaxed
// perf override). Use run.sh which handles this automatically.
//
// Run standalone:
//   GATEWAY_URL=http://localhost:5050 k6 run perf/gateway-ratelimit.js

import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:5050';
const rateLimitHits = new Rate('rate_limit_429_rate');

export const options = {
  scenarios: {
    rate_limit_probe: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 15,        // exceeds 10/min auth limit
      maxDuration: '30s',
    },
  },
  thresholds: {
    // We EXPECT 429s — at least 20% of requests should be rate-limited
    rate_limit_429_rate: ['rate>0.2'],
  },
};

export default function () {
  // Rapidly hit the auth login endpoint to trigger rate limiting.
  // Auth rate limit is 10/min per IP. We send 15 requests in quick succession.
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    emailOrUsername: 'nonexistent',
    password: 'doesntmatter',
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /auth/login (rate-limit-probe)' },
    responseType: 'none',
  });

  const is429 = res.status === 429;
  rateLimitHits.add(is429);

  check(res, {
    'got 401 or 429': (r) => r.status === 401 || r.status === 429,
  });
}
