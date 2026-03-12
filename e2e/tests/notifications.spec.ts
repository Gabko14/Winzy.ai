import { test, expect, TEST_USER } from "../fixtures/base";

const API_BASE = "http://localhost:5050";

/**
 * Notifications E2E tests.
 *
 * Tests the full user journey: bell icon on TodayScreen, opening the
 * notifications screen, seeing notifications, marking as read, and
 * verifying badge state. Uses the social-service friend-request flow
 * to generate real notifications via NATS.
 */

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
        await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("notifications-bell")).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Bell icon visible on Today screen",
        });
      });

      await test.step("bell has no unread badge", async () => {
        // New user should have zero unread — no badge rendered
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
    test.describe.configure({ mode: "serial" });

    let userAToken: string;
    let userAId: string;
    let userBToken: string;
    let userBId: string;
    let userBUsername: string;
    let userBEmail: string;

    test("setup: register two users and trigger a notification", async ({ request }) => {
      const tsA = Date.now();
      const tsB = tsA + 1;
      const usernameA = `e2e_notifA_${tsA}`;
      const usernameB = `e2e_notifB_${tsB}`;
      userBUsername = usernameB;
      userBEmail = `${usernameB}@winzy.test`;

      await test.step("register user A", async () => {
        const res = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: `${usernameA}@winzy.test`,
            username: usernameA,
            password: TEST_USER.password,
            displayName: "User A",
          },
        });
        expect(res.status()).toBe(201);
        const body = await res.json();
        userAToken = body.accessToken;
        userAId = body.user.id;
      });

      await test.step("register user B", async () => {
        const res = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: userBEmail,
            username: usernameB,
            password: TEST_USER.password,
            displayName: "User B",
          },
        });
        expect(res.status()).toBe(201);
        const body = await res.json();
        userBToken = body.accessToken;
        userBId = body.user.id;
      });

      await test.step("user A sends friend request to user B", async () => {
        const res = await request.post(`${API_BASE}/social/friends/request`, {
          headers: { Authorization: `Bearer ${userAToken}` },
          data: { friendId: userBId },
        });
        expect(res.status()).toBe(201);
        test.info().annotations.push({
          type: "step",
          description: `Friend request sent from ${usernameA} to ${usernameB}`,
        });
      });

      // Wait for NATS event to propagate and notification-service to create the record
      await test.step("wait for notification to be created", async () => {
        // Poll the notifications API for user B until a notification appears (max 10s)
        let found = false;
        for (let i = 0; i < 20; i++) {
          const res = await request.get(`${API_BASE}/notifications/unread-count`, {
            headers: { Authorization: `Bearer ${userBToken}` },
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
      });
    });

    test("user B sees unread badge and can open notifications", async ({ unauthenticatedPage: page }) => {
      await test.step("sign in as user B", async () => {
        await page.goto("/");
        await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });

        await page.getByLabel("Email or username").fill(userBEmail);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Sign in" }).click();
      });

      await test.step("complete profile if prompted", async () => {
        // User B was registered with displayName, but check just in case
        const result = await Promise.race([
          page.getByText("What should we call you?").waitFor({ timeout: 5_000 }).then(() => "profile-completion"),
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")).waitFor({ timeout: 5_000 }).then(() => "today"),
        ]);

        if (result === "profile-completion") {
          await page.getByLabel("Display name").fill("User B");
          await page.getByRole("button", { name: "Continue" }).click();
        }
      });

      await test.step("verify Today screen loads", async () => {
        await expect(
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
        ).toBeVisible({ timeout: 10_000 });
      });

      await test.step("verify bell icon has unread badge", async () => {
        await expect(page.getByTestId("notifications-bell")).toBeVisible();
        // The unread badge should appear (polling-based, may need brief wait)
        await expect(page.getByTestId("unread-badge")).toBeVisible({ timeout: 10_000 });
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

        // Should see "New friend request" notification
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

    test("user B can mark all notifications as read", async ({ unauthenticatedPage: page }) => {
      await test.step("sign in as user B", async () => {
        await page.goto("/");
        await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });

        await page.getByLabel("Email or username").fill(userBEmail);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Sign in" }).click();
      });

      await test.step("navigate past profile completion if needed", async () => {
        const result = await Promise.race([
          page.getByText("What should we call you?").waitFor({ timeout: 5_000 }).then(() => "profile-completion"),
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")).waitFor({ timeout: 5_000 }).then(() => "today"),
        ]);

        if (result === "profile-completion") {
          await page.getByLabel("Display name").fill("User B");
          await page.getByRole("button", { name: "Continue" }).click();
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
        const markAllButton = page.getByRole("button", { name: "Mark all as read" });
        await expect(markAllButton).toBeVisible();
        await markAllButton.click();
        test.info().annotations.push({
          type: "step",
          description: "Clicked 'Mark all as read'",
        });
      });

      await test.step("verify unread dots are gone", async () => {
        // After marking all read, unread dots should disappear
        await expect(page.getByTestId("unread-dot")).not.toBeVisible({ timeout: 5_000 });
        test.info().annotations.push({
          type: "step",
          description: "All unread dots cleared after mark-all-read",
        });
      });

      await test.step("verify mark-all-read button is gone", async () => {
        // With no unread notifications, the "Mark all as read" button should be hidden
        await expect(page.getByRole("button", { name: "Mark all as read" })).not.toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Mark-all-read button hidden after all read",
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
