import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";
import type { APIRequestContext } from "@playwright/test";

const API_BASE = "http://localhost:5050";

/**
 * Notifications E2E tests.
 *
 * Tests the full user journey: bell icon on TodayScreen, opening the
 * notifications screen, seeing notifications, marking as read, and
 * verifying badge state. Uses the social-service friend-request flow
 * to generate real notifications via NATS.
 *
 * Each test is fully independent — creates its own users and data via API.
 */

interface NotifPair {
  userBEmail: string;
}

/** Register two users, send a friend request from A to B, and wait for the notification to appear. */
async function setupNotifPair(request: APIRequestContext, label: string): Promise<NotifPair> {
  const ts = Date.now();
  const usernameA = `e2e_${label}A_${ts}`;
  const usernameB = `e2e_${label}B_${ts + 1}`;

  // Register user A
  const resA = await request.post(`${API_BASE}/auth/register`, {
    data: {
      email: `${usernameA}@winzy.test`,
      username: usernameA,
      password: TEST_USER.password,
      displayName: "User A",
    },
  });
  expect(resA.status()).toBe(201);
  const bodyA = await resA.json();

  // Register user B
  const resB = await request.post(`${API_BASE}/auth/register`, {
    data: {
      email: `${usernameB}@winzy.test`,
      username: usernameB,
      password: TEST_USER.password,
      displayName: "User B",
    },
  });
  expect(resB.status()).toBe(201);
  const bodyB = await resB.json();

  // A sends friend request to B (triggers notification via NATS)
  const reqRes = await request.post(`${API_BASE}/social/friends/request`, {
    headers: { Authorization: `Bearer ${bodyA.accessToken}` },
    data: { friendId: bodyB.user.id },
  });
  expect(reqRes.status()).toBe(201);

  // Poll until notification appears (max 10s)
  let found = false;
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${API_BASE}/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${bodyB.accessToken}` },
    });
    if (res.ok()) {
      const body = await res.json();
      if (body.unreadCount > 0) {
        found = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(found, "Notification should appear for user B within 10 seconds").toBeTruthy();

  return {
    userBEmail: `${usernameB}@winzy.test`,
  };
}

test.describe("Notifications", () => {
  test.describe("Empty state", () => {
    test("new user sees bell icon and empty notifications", async ({ unauthenticatedPage: page }) => {
      const uniqueUser = `e2e_notif_empty_${Date.now()}`;
      const email = `${uniqueUser}@winzy.test`;
      const password = TEST_USER.password;
      const displayName = "Notif Tester";

      await test.step("register and complete profile", async () => {
        await page.goto("/");
        await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
        await page.getByRole("button", { name: "Sign up" }).click();
        await expect(page.getByText("Create your account")).toBeVisible();

        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Username").fill(uniqueUser);
        await page.getByLabel("Password").fill(password);
        await page.getByRole("button", { name: "Create account" }).click();

        await expect(page.getByText("What should we call you?")).toBeVisible({ timeout: 10_000 });
        await page.getByLabel("Display name").fill(displayName);
        await page.getByRole("button", { name: "Continue" }).click();
      });

      await test.step("verify Today screen has bell icon", async () => {
        await dismissWelcomeIfPresent(page);
        await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("notifications-bell")).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Bell icon visible on Today screen",
        });
      });

      await test.step("bell has no unread badge", async () => {
        await expect(page.getByTestId("unread-badge")).not.toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "No unread badge for new user",
        });
      });

      await test.step("tap bell to open notifications", async () => {
        await page.getByTestId("notifications-bell").click();
        test.info().annotations.push({
          type: "step",
          description: "Tapped bell icon",
        });
      });

      await test.step("verify empty state in notification screen", async () => {
        await expect(page.getByText("All caught up")).toBeVisible({ timeout: 10_000 });
        await expect(
          page.getByText("No notifications yet. They'll appear here when your friends interact with you."),
        ).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Empty notification screen displayed",
        });
      });
    });
  });

  test.describe("Notification flow with friend request", () => {
    test("user B sees unread badge and can open notifications", async ({ unauthenticatedPage: page, request }) => {
      const pair = await setupNotifPair(request, "notifBadge");

      await test.step("sign in as user B", async () => {
        await page.goto("/");
        await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });

        await page.getByLabel("Email or username").fill(pair.userBEmail);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Sign in" }).click();
      });

      await test.step("complete profile if prompted", async () => {
        const result = await Promise.race([
          page.getByText("What should we call you?").waitFor({ timeout: 5_000 }).then(() => "profile-completion"),
          page.getByText("Welcome to Winzy").waitFor({ timeout: 5_000 }).then(() => "welcome"),
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")).waitFor({ timeout: 5_000 }).then(() => "today"),
        ]);

        if (result === "profile-completion") {
          await page.getByLabel("Display name").fill("User B");
          await page.getByRole("button", { name: "Continue" }).click();
          await dismissWelcomeIfPresent(page);
        } else if (result === "welcome") {
          await dismissWelcomeIfPresent(page);
        }
      });

      await test.step("verify Today screen loads", async () => {
        await expect(
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
        ).toBeVisible({ timeout: 10_000 });
      });

      await test.step("verify bell icon has unread badge", async () => {
        await expect(page.getByTestId("notifications-bell")).toBeVisible();
        // Reload to re-mount hooks and fire the initial poll immediately
        await page.reload();
        await expect(
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
        ).toBeVisible({ timeout: 10_000 });
        const bellBadge = page.getByTestId("notifications-bell").getByTestId("unread-badge");
        await expect(bellBadge).toBeVisible({ timeout: 15_000 });
        test.info().annotations.push({
          type: "step",
          description: "Unread badge visible on bell icon",
        });
      });

      await test.step("tap bell to open notifications", async () => {
        await page.getByTestId("notifications-bell").click();
        test.info().annotations.push({
          type: "step",
          description: "Opened notifications screen",
        });
      });

      await test.step("verify notification screen shows the friend request notification", async () => {
        await expect(page.getByTestId("notification-screen")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("notifications-list")).toBeVisible();

        await expect(page.getByText("New friend request")).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Friend request notification visible in list",
        });
      });

      await test.step("verify unread dot is shown", async () => {
        await expect(page.getByTestId("unread-dot").first()).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Unread dot visible on notification row",
        });
      });
    });

    test("user B can mark all notifications as read", async ({ unauthenticatedPage: page, request }) => {
      const pair = await setupNotifPair(request, "notifRead");

      await test.step("sign in as user B", async () => {
        await page.goto("/");
        await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });

        await page.getByLabel("Email or username").fill(pair.userBEmail);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Sign in" }).click();
      });

      await test.step("navigate past profile completion if needed", async () => {
        const result = await Promise.race([
          page.getByText("What should we call you?").waitFor({ timeout: 5_000 }).then(() => "profile-completion"),
          page.getByText("Welcome to Winzy").waitFor({ timeout: 5_000 }).then(() => "welcome"),
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")).waitFor({ timeout: 5_000 }).then(() => "today"),
        ]);

        if (result === "profile-completion") {
          await page.getByLabel("Display name").fill("User B");
          await page.getByRole("button", { name: "Continue" }).click();
          await dismissWelcomeIfPresent(page);
        } else if (result === "welcome") {
          await dismissWelcomeIfPresent(page);
        }
      });

      await test.step("navigate to notifications", async () => {
        await expect(
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
        ).toBeVisible({ timeout: 10_000 });
        await page.getByTestId("notifications-bell").click();
        await expect(page.getByTestId("notification-screen")).toBeVisible({ timeout: 10_000 });
      });

      await test.step("tap mark all as read", async () => {
        const markAllButton = page.getByRole("button", { name: "Mark all notifications as read" });
        await expect(markAllButton).toBeVisible();
        await markAllButton.click();
        test.info().annotations.push({
          type: "step",
          description: "Clicked 'Mark all as read'",
        });
      });

      await test.step("verify unread dots are gone", async () => {
        await expect(page.getByTestId("unread-dot")).not.toBeVisible({ timeout: 5_000 });
        test.info().annotations.push({
          type: "step",
          description: "All unread dots cleared after mark-all-read",
        });
      });

      await test.step("verify mark-all-read button is gone", async () => {
        await expect(page.getByRole("button", { name: "Mark all notifications as read" })).not.toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Mark-all-read button hidden after all read",
        });
      });
    });
  });

  test.describe("Error state", () => {
    test("shows error state with retry when notifications API fails", async ({ unauthenticatedPage: page }) => {
      const uniqueUser = `e2e_notif_err_${Date.now()}`;
      const email = `${uniqueUser}@winzy.test`;
      const password = TEST_USER.password;

      await test.step("register and complete profile", async () => {
        await page.goto("/");
        await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
        await page.getByRole("button", { name: "Sign up" }).click();
        await expect(page.getByText("Create your account")).toBeVisible();

        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Username").fill(uniqueUser);
        await page.getByLabel("Password").fill(password);
        await page.getByRole("button", { name: "Create account" }).click();

        await expect(page.getByText("What should we call you?")).toBeVisible({ timeout: 10_000 });
        await page.getByLabel("Display name").fill("Error Tester");
        await page.getByRole("button", { name: "Continue" }).click();
      });

      await test.step("wait for Today screen", async () => {
        await dismissWelcomeIfPresent(page);
        await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "Today screen loaded",
        });
      });

      await test.step("intercept notifications API with 500 error", async () => {
        await page.route(`${API_BASE}/notifications?*`, (route) => {
          route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Internal Server Error" }),
          });
        });
        test.info().annotations.push({
          type: "step",
          description: "Route intercept active for GET /notifications",
        });
      });

      await test.step("tap bell to open notifications", async () => {
        await page.getByTestId("notifications-bell").click();
        test.info().annotations.push({
          type: "step",
          description: "Tapped bell icon to open notifications",
        });
      });

      await test.step("verify ErrorState renders with error message", async () => {
        await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "ErrorState title 'Something went wrong' visible",
        });
      });

      await test.step("verify retry button is visible", async () => {
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Retry button 'Try again' visible",
        });
      });

      await test.step("remove intercept and tap retry", async () => {
        await page.unroute(`${API_BASE}/notifications?*`);
        await page.getByRole("button", { name: "Try again" }).click();
        test.info().annotations.push({
          type: "step",
          description: "Removed intercept and tapped retry",
        });
      });

      await test.step("verify recovery — error state gone, empty state shown", async () => {
        await expect(page.getByText("Something went wrong", { exact: true })).not.toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("All caught up")).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "Recovery successful — empty state shown after retry",
        });
      });
    });
  });

  test.describe("API contract", () => {
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
});
