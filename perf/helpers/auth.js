// Shared auth helpers for k6 load tests.
// Registers a unique user and returns { accessToken, refreshToken, userId }.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:5050';

/**
 * Register a unique test user and return tokens.
 * Uses VU id + iteration + timestamp to guarantee uniqueness.
 */
export function registerUser() {
  const tag = `${__VU}_${__ITER}_${Date.now()}`;
  const payload = JSON.stringify({
    email: `perf_${tag}@test.local`,
    username: `perf_${tag}`,
    password: 'Test1234!@#',
    displayName: `Perf User ${tag}`,
  });

  const res = http.post(`${BASE_URL}/auth/register`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /auth/register' },
  });

  const ok = check(res, {
    'register: status 201': (r) => r.status === 201,
    'register: has accessToken': (r) => {
      try { return JSON.parse(r.body).accessToken !== undefined; } catch { return false; }
    },
  });

  if (!ok) {
    console.error(`Register failed: ${res.status} ${res.body}`);
    return null;
  }

  const body = JSON.parse(res.body);
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.profile?.id,
    username: `perf_${tag}`,
  };
}

/**
 * Login with email/username and password, return tokens.
 */
export function loginUser(emailOrUsername, password) {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    emailOrUsername,
    password,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /auth/login' },
  });

  const ok = check(res, {
    'login: status 200': (r) => r.status === 200,
  });

  if (!ok) return null;

  const body = JSON.parse(res.body);
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

/**
 * Return Authorization header object for authenticated requests.
 */
export function authHeaders(accessToken) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  };
}

export { BASE_URL };
