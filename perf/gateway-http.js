// Gateway HTTP load test — k6
//
// Scenarios:
//   1. auth_public    — Register + Login
//   2. habit_crud     — Create/list/complete habits (authenticated, standard limit)
//   3. public_read    — Public flame page + health (unauthenticated)
//
// NOTE: Designed to run with relaxed auth rate limits (see docker-compose.perf.yml).
// Rate limit validation is a separate script: gateway-ratelimit.js
//
// Run:
//   k6 run perf/gateway-http.js
//   GATEWAY_URL=http://localhost:5050 k6 run perf/gateway-http.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { registerUser, authHeaders, BASE_URL } from './helpers/auth.js';

// ── Custom metrics ──────────────────────────────────────────────────
const authErrors = new Rate('auth_error_rate');
const habitErrors = new Rate('habit_error_rate');
const publicErrors = new Rate('public_error_rate');
const habitCreateDuration = new Trend('habit_create_duration');

// ── Options ─────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Auth public endpoints — register + login flow
    auth_public: {
      executor: 'constant-arrival-rate',
      rate: 2,               // 2 iterations/sec
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'authPublicScenario',
      tags: { scenario_name: 'auth_public' },
    },

    // Authenticated habit CRUD — moderate load
    habit_crud: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '5s', target: 0 },
      ],
      exec: 'habitCrudScenario',
      tags: { scenario_name: 'habit_crud' },
    },

    // Public/unauthenticated reads — higher concurrency
    public_read: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      exec: 'publicReadScenario',
      tags: { scenario_name: 'public_read' },
    },

  },

  thresholds: {
    // Global
    'http_req_failed{scenario_name:auth_public}': ['rate<0.05'],
    'http_req_failed{scenario_name:habit_crud}': ['rate<0.05'],
    'http_req_failed{scenario_name:public_read}': ['rate<0.01'],
    'http_req_duration{scenario_name:auth_public}': ['p(95)<2000'],
    'http_req_duration{scenario_name:habit_crud}': ['p(95)<1000'],
    'http_req_duration{scenario_name:public_read}': ['p(95)<500'],

    // Custom
    auth_error_rate: ['rate<0.05'],
    habit_error_rate: ['rate<0.05'],
    public_error_rate: ['rate<0.01'],
    habit_create_duration: ['p(95)<1500'],

  },
};

// ── Scenario: Auth public (register + login) ───────────────────────
export function authPublicScenario() {
  group('Register new user', () => {
    const user = registerUser();
    authErrors.add(user === null);
    if (!user) return;

    sleep(0.5);

    // Login with the user we just created
    group('Login', () => {
      const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
        emailOrUsername: user.username,
        password: 'Test1234!@#',
      }), {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'POST /auth/login' },
      });

      const ok = check(res, {
        'login: status 200': (r) => r.status === 200,
      });
      authErrors.add(!ok);
    });
  });

  sleep(1);
}

// ── Scenario: Habit CRUD (authenticated) ────────────────────────────
export function habitCrudScenario() {
  // Each VU registers its own user to get a token
  const user = registerUser();
  if (!user) {
    habitErrors.add(true);
    sleep(2);
    return;
  }

  const auth = authHeaders(user.accessToken);

  // Create a habit
  let habitId = null;
  group('Create habit', () => {
    const start = Date.now();
    const res = http.post(`${BASE_URL}/habits`, JSON.stringify({
      name: `Perf Habit ${__VU}_${__ITER}`,
      frequency: 'daily',
      color: '#FF5733',
    }), {
      ...auth,
      tags: { name: 'POST /habits' },
    });

    habitCreateDuration.add(Date.now() - start);

    const ok = check(res, {
      'create habit: status 201': (r) => r.status === 201,
    });
    habitErrors.add(!ok);

    if (ok) {
      try { habitId = JSON.parse(res.body).id; } catch { /* ignore */ }
    }
  });

  sleep(0.3);

  // List habits
  group('List habits', () => {
    const res = http.get(`${BASE_URL}/habits`, {
      ...auth,
      tags: { name: 'GET /habits' },
      responseType: 'none',
    });

    const ok = check(res, {
      'list habits: status 200': (r) => r.status === 200,
    });
    habitErrors.add(!ok);
  });

  sleep(0.3);

  // Complete a habit
  if (habitId) {
    group('Complete habit', () => {
      const res = http.post(`${BASE_URL}/habits/${habitId}/complete`, null, {
        ...auth,
        tags: { name: 'POST /habits/{id}/complete' },
        responseType: 'none',
      });

      const ok = check(res, {
        'complete habit: status 200 or 201': (r) => r.status === 200 || r.status === 201,
      });
      habitErrors.add(!ok);
    });

    sleep(0.3);

    // Get habit stats
    group('Habit stats', () => {
      const res = http.get(`${BASE_URL}/habits/${habitId}/stats`, {
        ...auth,
        tags: { name: 'GET /habits/{id}/stats' },
        responseType: 'none',
      });

      const ok = check(res, {
        'habit stats: status 200': (r) => r.status === 200,
      });
      habitErrors.add(!ok);
    });
  }

  sleep(1);
}

// ── Scenario: Public reads (unauthenticated) ────────────────────────
export function publicReadScenario() {
  group('Health check', () => {
    const res = http.get(`${BASE_URL}/health`, {
      tags: { name: 'GET /health' },
      responseType: 'none',
    });

    const ok = check(res, {
      'health: status 200': (r) => r.status === 200,
    });
    publicErrors.add(!ok);
  });

  sleep(0.5);

  // Public flame page — uses a username that may not exist, expect 200 or 404
  group('Public flame page', () => {
    const res = http.get(`${BASE_URL}/habits/public/nonexistent_user`, {
      tags: { name: 'GET /habits/public/{username}' },
      responseType: 'none',
    });

    const ok = check(res, {
      'public flame: status 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
    publicErrors.add(!ok);
  });

  sleep(0.5);
}

