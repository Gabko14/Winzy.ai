import { test, expect } from "@playwright/test";

const API_BASE = "http://localhost:5050";

/**
 * Notifications E2E tests.
 *
 * The NotificationScreen is not yet wired into app navigation, so these tests
 * verify the notifications API contract through an authenticated session.
 * Once the main app has a navigation bar, add UI-level tests that click into
 * the notifications tab and assert on the rendered list / empty state.
 */
test.describe.configure({ mode: "serial" });

test.describe("Notifications", () => {
  let accessToken: string;

  test("setup: register a test user", async ({ request }) => {
    const uniqueUser = `e2e_notif_${Date.now()}`;
    const res = await request.post(`${API_BASE}/auth/register`, {
      data: {
        email: `${uniqueUser}@winzy.test`,
        username: uniqueUser,
        password: "TestPassword123",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    accessToken = body.accessToken;
  });

  test("unread count is zero for new user", async ({ request }) => {
    const res = await request.get(`${API_BASE}/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ unreadCount: 0 });
  });

  test("notifications list is empty for new user", async ({ request }) => {
    const res = await request.get(`${API_BASE}/notifications?page=1&pageSize=20`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  test("mark-all-read returns zero when nothing to mark", async ({ request }) => {
    const res = await request.put(`${API_BASE}/notifications/read-all`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status()).toBe(200);
    expect((await res.json()).markedAsRead).toBe(0);
  });

  test("notifications endpoints require authentication", async ({ request }) => {
    const endpoints = [
      { path: "/notifications?page=1&pageSize=20", method: "get" as const },
      { path: "/notifications/unread-count", method: "get" as const },
      { path: "/notifications/read-all", method: "put" as const },
    ];

    for (const ep of endpoints) {
      const res = await request[ep.method](`${API_BASE}${ep.path}`);
      expect(res.status(), `${ep.method.toUpperCase()} ${ep.path} should require auth`).toBe(401);
    }
  });
});
