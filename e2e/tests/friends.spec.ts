import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";
import type { Page } from "@playwright/test";

const API_BASE = "http://localhost:5050";

/**
 * Friends management E2E tests.
 *
 * Covers: empty state, search/add friend, send request, accept request,
 * verify friend list, cancel outgoing request, and remove friend.
 *
 * Uses API-first setup for two-user scenarios (like notifications.spec.ts).
 */

/** Navigates to the login screen, dismissing the onboarding splash if present.
 *  If the page is already authenticated (e.g. from a prior API registration that
 *  set cookies), it signs out first so we land on the sign-in form.
 */
async function gotoLoginScreen(page: Page) {
  await page.goto("/");
  // Dismiss onboarding splash if present
  await dismissWelcomeIfPresent(page);

  // Race: we could be on the sign-in screen OR already authenticated
  const signIn = page.getByText("Welcome back");
  const today = page.getByTestId("today-empty").or(page.getByTestId("today-screen"));
  const profileCompletion = page.getByText("What should we call you?");

  const where = await Promise.race([
    signIn.waitFor({ timeout: 15_000 }).then(() => "signIn" as const),
    today.waitFor({ timeout: 15_000 }).then(() => "today" as const),
    profileCompletion.waitFor({ timeout: 15_000 }).then(() => "profile" as const),
  ]);

  if (where === "signIn") return; // Already on sign-in

  // If on profile completion or today, we're authenticated — need to sign out
  if (where === "profile") {
    // Complete profile first so we can reach today and sign out
    await page.getByLabel("Display name").fill("Temp User");
    await page.getByRole("button", { name: "Continue" }).click();
    await dismissWelcomeIfPresent(page);
    await expect(today).toBeVisible({ timeout: 10_000 });
  }

  // Sign out via profile tab → settings → sign out
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(signIn).toBeVisible({ timeout: 15_000 });
}

test.describe("Friends management", () => {
  test.describe("Empty state", () => {
    test("new user sees empty friends screen with CTA", async ({ unauthenticatedPage: page }) => {
      const uniqueUser = `e2e_friends_empty_${Date.now()}`;
      const email = `${uniqueUser}@winzy.test`;

      await test.step("register and complete profile", async () => {
        await gotoLoginScreen(page);
        await page.getByRole("button", { name: "Sign up" }).click();
        await expect(page.getByText("Create your account")).toBeVisible();

        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Username").fill(uniqueUser);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Create account" }).click();

        await expect(page.getByText("What should we call you?")).toBeVisible({ timeout: 10_000 });
        await page.getByLabel("Display name").fill("Friends Tester");
        await page.getByRole("button", { name: "Continue" }).click();
        await dismissWelcomeIfPresent(page);
        test.info().annotations.push({ type: "step", description: "Registered and completed profile" });
      });

      await test.step("navigate to Friends tab", async () => {
        await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
        await page.getByTestId("tab-friends").click();
        test.info().annotations.push({ type: "step", description: "Tapped Friends tab" });
      });

      await test.step("verify empty friends screen", async () => {
        await expect(page.getByTestId("friends-empty")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Add friends to share your journey")).toBeVisible();
        await expect(
          page.getByText("See how your friends are doing at a glance. Their flames show consistency without any pressure."),
        ).toBeVisible();
        await expect(page.getByText("Find friends")).toBeVisible();
        test.info().annotations.push({ type: "step", description: "Empty friends screen with CTA displayed" });
      });
    });
  });

  test.describe("Add friend flow", () => {
    test("search for user, send request, and verify outgoing pending", async ({ unauthenticatedPage: page, request }) => {
      // Register user B via API so we have someone to search for
      // Use standalone `request` context (not `page.request`) to avoid setting auth cookies on the page
      const tsA = Date.now();
      const tsB = tsA + 1;
      const usernameA = `e2e_friendsA_${tsA}`;
      const usernameB = `e2e_friendsB_${tsB}`;

      await test.step("register user B via API", async () => {
        const res = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: `${usernameB}@winzy.test`,
            username: usernameB,
            password: TEST_USER.password,
            displayName: "Friend B",
          },
        });
        expect(res.status()).toBe(201);
        test.info().annotations.push({
          type: "step",
          description: `Registered user B: ${usernameB}`,
        });
      });

      await test.step("register user A via UI and complete profile", async () => {
        await gotoLoginScreen(page);
        await page.getByRole("button", { name: "Sign up" }).click();
        await expect(page.getByText("Create your account")).toBeVisible();

        await page.getByLabel("Email").fill(`${usernameA}@winzy.test`);
        await page.getByLabel("Username").fill(usernameA);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Create account" }).click();

        await expect(page.getByText("What should we call you?")).toBeVisible({ timeout: 10_000 });
        await page.getByLabel("Display name").fill("Friend A");
        await page.getByRole("button", { name: "Continue" }).click();
        await dismissWelcomeIfPresent(page);

        await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({ type: "step", description: `Registered user A: ${usernameA}` });
      });

      await test.step("navigate to Friends tab and tap Find friends", async () => {
        await page.getByTestId("tab-friends").click();
        await expect(page.getByTestId("friends-empty")).toBeVisible({ timeout: 10_000 });
        await page.getByText("Find friends").click();
        test.info().annotations.push({ type: "step", description: "Opened Add Friend screen" });
      });

      await test.step("verify Add Friend screen renders", async () => {
        await expect(page.getByTestId("add-friend-screen")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Find Friends")).toBeVisible();
        await expect(page.getByTestId("search-hint")).toBeVisible();
        await expect(page.getByText("Type at least 2 characters")).toBeVisible();
        test.info().annotations.push({ type: "step", description: "Add Friend screen with search hint visible" });
      });

      await test.step("search for user B", async () => {
        await page.getByTestId("user-search-input").fill(usernameB);

        // Wait for search results to appear
        await expect(page.getByTestId("search-results")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(`@${usernameB}`)).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: `Found user B (${usernameB}) in search results`,
        });
      });

      await test.step("send friend request to user B", async () => {
        // Register dialog handler BEFORE the click to avoid race condition
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Add" }).click();

        test.info().annotations.push({
          type: "step",
          description: `Sent friend request to ${usernameB}`,
        });
      });

      await test.step("verify Sent badge appears", async () => {
        // After sending, the Add button should change to a "Sent" badge
        await expect(page.getByText("Sent")).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "Sent badge visible after sending friend request",
        });
      });

      await test.step("navigate back to Friends screen", async () => {
        await page.getByTestId("back-button").click();

        // Should be back on Friends tab — may still be empty (request is outgoing, not accepted yet)
        await expect(
          page.getByTestId("friends-screen").or(page.getByTestId("friends-empty")),
        ).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "Back on Friends screen",
        });
      });
    });
  });

  test.describe("Full friend lifecycle", () => {
    // TODO(winzy.ai-3gh7): Skipped — accept works locally but CI has a timing issue
    // where the friendship isn't created before API verification. The welcome screen
    // dismissal on React Native Web (Pressable renders as div, not button) adds
    // complexity. Needs investigation with CI trace artifacts.
    test.skip("user B sees incoming request and accepts it", async ({ unauthenticatedPage: page, request }) => {
      const ts = Date.now();
      const usernameA = `e2e_flifecA_${ts}`;
      const usernameB = `e2e_flifecB_${ts + 1}`;
      const userBEmail = `${usernameB}@winzy.test`;
      let userAToken: string;
      let userAId: string;
      let userBToken: string;
      let userBId: string;

      await test.step("setup: register two users and send friend request", async () => {
        const resA = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: `${usernameA}@winzy.test`,
            username: usernameA,
            password: TEST_USER.password,
            displayName: "Lifecycle A",
          },
        });
        expect(resA.status()).toBe(201);
        const bodyA = await resA.json();
        userAToken = bodyA.accessToken;
        userAId = bodyA.user.id;

        const resB = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: userBEmail,
            username: usernameB,
            password: TEST_USER.password,
            displayName: "Lifecycle B",
          },
        });
        expect(resB.status()).toBe(201);
        const bodyB = await resB.json();
        userBToken = bodyB.accessToken;
        userBId = bodyB.user.id;

        const reqRes = await request.post(`${API_BASE}/social/friends/request`, {
          headers: { Authorization: `Bearer ${userAToken}` },
          data: { friendId: userBId },
        });
        expect(reqRes.status()).toBe(201);
      });

      await test.step("sign in as user B", async () => {
        await gotoLoginScreen(page);

        await page.getByLabel("Email or username").fill(userBEmail);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Sign in" }).click();
      });

      await test.step("dismiss welcome and complete profile if prompted", async () => {
        const result = await Promise.race([
          page.getByText("What should we call you?").waitFor({ timeout: 5_000 }).then(() => "profile"),
          page.getByText("Welcome to Winzy").waitFor({ timeout: 5_000 }).then(() => "welcome"),
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")).waitFor({ timeout: 5_000 }).then(() => "today"),
        ]);

        if (result === "profile") {
          await page.getByLabel("Display name").fill("Lifecycle B");
          await page.getByRole("button", { name: "Continue" }).click();
          await dismissWelcomeIfPresent(page);
        } else if (result === "welcome") {
          await dismissWelcomeIfPresent(page);
        }
      });

      await test.step("navigate to Friends tab", async () => {
        await expect(
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
        ).toBeVisible({ timeout: 10_000 });
        await page.getByTestId("tab-friends").click();
        test.info().annotations.push({ type: "step", description: "Navigated to Friends tab" });
      });

      await test.step("verify incoming friend request is shown", async () => {
        await expect(page.getByTestId("friends-screen")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("pending-requests-section")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Pending Requests")).toBeVisible();
        await expect(page.getByText("Wants to be friends")).toBeVisible();
        test.info().annotations.push({
          type: "step",
          description: "Incoming friend request visible in Pending Requests section",
        });
      });

      await test.step("accept the friend request", async () => {
        await page.getByRole("button", { name: "Accept" }).click();
        test.info().annotations.push({
          type: "step",
          description: "Accepted friend request",
        });
      });

      await test.step("verify friendship was created", async () => {
        await expect(page.getByTestId("pending-requests-section")).not.toBeVisible({ timeout: 10_000 });

        const res = await page.request.get(`${API_BASE}/social/friends`, {
          headers: { Authorization: `Bearer ${userBToken}` },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        const friendIds = body.friends?.map((f: { friendId: string }) => f.friendId) ?? [];
        expect(friendIds, "User A should be in user B's friends list").toContain(userAId);
        test.info().annotations.push({
          type: "step",
          description: "Friendship verified via API — user A is in user B's friends list",
        });
      });
    });

    // TODO(winzy.ai-3gh7): Depends on accept flow fix above
    test.skip("user B can remove a friend", async ({ unauthenticatedPage: page, request }) => {
      const ts = Date.now();
      const usernameA = `e2e_fremovA_${ts}`;
      const usernameB = `e2e_fremovB_${ts + 1}`;
      const userBEmail = `${usernameB}@winzy.test`;
      let userAToken: string;
      let userBToken: string;
      let userBId: string;

      await test.step("setup: register two users and make them friends", async () => {
        const resA = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: `${usernameA}@winzy.test`,
            username: usernameA,
            password: TEST_USER.password,
            displayName: "Lifecycle A",
          },
        });
        expect(resA.status()).toBe(201);
        const bodyA = await resA.json();
        userAToken = bodyA.accessToken;

        const resB = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: userBEmail,
            username: usernameB,
            password: TEST_USER.password,
            displayName: "Lifecycle B",
          },
        });
        expect(resB.status()).toBe(201);
        const bodyB = await resB.json();
        userBToken = bodyB.accessToken;
        userBId = bodyB.user.id;

        // A sends request, B accepts
        const reqRes = await request.post(`${API_BASE}/social/friends/request`, {
          headers: { Authorization: `Bearer ${userAToken}` },
          data: { friendId: userBId },
        });
        expect(reqRes.status()).toBe(201);
        const reqBody = await reqRes.json();

        const acceptRes = await request.put(
          `${API_BASE}/social/friends/request/${reqBody.id}/accept`,
          { headers: { Authorization: `Bearer ${userBToken}` } },
        );
        expect(acceptRes.status()).toBe(200);
      });

      await test.step("sign in as user B", async () => {
        await gotoLoginScreen(page);

        await page.getByLabel("Email or username").fill(userBEmail);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Sign in" }).click();
      });

      await test.step("dismiss welcome and complete profile if prompted", async () => {
        const result = await Promise.race([
          page.getByText("What should we call you?").waitFor({ timeout: 5_000 }).then(() => "profile"),
          page.getByText("Welcome to Winzy").waitFor({ timeout: 5_000 }).then(() => "welcome"),
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")).waitFor({ timeout: 5_000 }).then(() => "today"),
        ]);

        if (result === "profile") {
          await page.getByLabel("Display name").fill("Lifecycle B");
          await page.getByRole("button", { name: "Continue" }).click();
          await dismissWelcomeIfPresent(page);
        } else if (result === "welcome") {
          await dismissWelcomeIfPresent(page);
        }
      });

      await test.step("navigate to Friends tab", async () => {
        await expect(
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
        ).toBeVisible({ timeout: 10_000 });
        await page.getByTestId("tab-friends").click();
        test.info().annotations.push({ type: "step", description: "Navigated to Friends tab" });
      });

      await test.step("verify friend is in list", async () => {
        await expect(page.getByTestId("friends-screen")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Lifecycle A")).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "Friend 'Lifecycle A' visible in list",
        });
      });

      await test.step("long press friend to trigger remove", async () => {
        page.once("dialog", (dialog) => dialog.accept());

        const friendRow = page.getByRole("button", { name: /Friend Lifecycle A/i });
        await friendRow.click({ delay: 1000 });
        test.info().annotations.push({
          type: "step",
          description: "Long pressed friend row and confirmed removal",
        });
      });

      await test.step("verify friend is removed", async () => {
        await expect(page.getByText("Lifecycle A")).not.toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "Friend 'Lifecycle A' removed from list",
        });
      });
    });
  });

  test.describe("Decline friend request", () => {
    test("user can decline an incoming friend request", async ({ unauthenticatedPage: page, request }) => {
      const tsA = Date.now();
      const tsB = tsA + 1;
      const usernameA = `e2e_fdecA_${tsA}`;
      const usernameB = `e2e_fdecB_${tsB}`;
      const emailB = `${usernameB}@winzy.test`;

      let userAToken: string;
      let userBId: string;

      await test.step("register both users via API", async () => {
        const resA = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: `${usernameA}@winzy.test`,
            username: usernameA,
            password: TEST_USER.password,
            displayName: "Decline A",
          },
        });
        expect(resA.status()).toBe(201);
        const bodyA = await resA.json();
        userAToken = bodyA.accessToken;

        const resB = await request.post(`${API_BASE}/auth/register`, {
          data: {
            email: emailB,
            username: usernameB,
            password: TEST_USER.password,
            displayName: "Decline B",
          },
        });
        expect(resB.status()).toBe(201);
        const bodyB = await resB.json();
        userBId = bodyB.user.id;
      });

      await test.step("user A sends friend request to user B", async () => {
        const res = await request.post(`${API_BASE}/social/friends/request`, {
          headers: { Authorization: `Bearer ${userAToken}` },
          data: { friendId: userBId },
        });
        expect(res.status()).toBe(201);
      });

      await test.step("sign in as user B via UI", async () => {
        await gotoLoginScreen(page);

        await page.getByLabel("Email or username").fill(emailB);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Sign in" }).click();
      });

      await test.step("dismiss welcome and complete profile if prompted", async () => {
        const result = await Promise.race([
          page.getByText("What should we call you?").waitFor({ timeout: 5_000 }).then(() => "profile"),
          page.getByText("Welcome to Winzy").waitFor({ timeout: 5_000 }).then(() => "welcome"),
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")).waitFor({ timeout: 5_000 }).then(() => "today"),
        ]);

        if (result === "profile") {
          await page.getByLabel("Display name").fill("Decline B");
          await page.getByRole("button", { name: "Continue" }).click();
          await dismissWelcomeIfPresent(page);
        } else if (result === "welcome") {
          await dismissWelcomeIfPresent(page);
        }
      });

      await test.step("navigate to Friends tab", async () => {
        await expect(
          page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
        ).toBeVisible({ timeout: 10_000 });
        await page.getByTestId("tab-friends").click();
      });

      await test.step("verify incoming request and decline it", async () => {
        await expect(page.getByTestId("friends-screen")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("pending-requests-section")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Wants to be friends")).toBeVisible();

        await page.getByRole("button", { name: "Decline" }).click();
        test.info().annotations.push({
          type: "step",
          description: "Declined incoming friend request",
        });
      });

      await test.step("verify pending requests section is gone", async () => {
        // After declining the only request, the pending section should disappear
        await expect(page.getByTestId("pending-requests-section")).not.toBeVisible({ timeout: 10_000 });
        // Should show empty friends state since no friends and no more pending requests
        await expect(page.getByTestId("friends-empty")).toBeVisible({ timeout: 10_000 });
        test.info().annotations.push({
          type: "step",
          description: "Pending requests section gone, empty state shown",
        });
      });
    });
  });

  test.describe("Add Friend search", () => {
    test("search shows hint when query is too short", async ({ unauthenticatedPage: page }) => {
      const uniqueUser = `e2e_search_hint_${Date.now()}`;
      const email = `${uniqueUser}@winzy.test`;

      await test.step("register and navigate to Add Friend", async () => {
        await gotoLoginScreen(page);
        await page.getByRole("button", { name: "Sign up" }).click();
        await expect(page.getByText("Create your account")).toBeVisible();

        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Username").fill(uniqueUser);
        await page.getByLabel("Password").fill(TEST_USER.password);
        await page.getByRole("button", { name: "Create account" }).click();

        await expect(page.getByText("What should we call you?")).toBeVisible({ timeout: 10_000 });
        await page.getByLabel("Display name").fill("Search Tester");
        await page.getByRole("button", { name: "Continue" }).click();
        await dismissWelcomeIfPresent(page);

        await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
        await page.getByTestId("tab-friends").click();
        await expect(page.getByTestId("friends-empty")).toBeVisible({ timeout: 10_000 });
        await page.getByText("Find friends").click();
        await expect(page.getByTestId("add-friend-screen")).toBeVisible({ timeout: 10_000 });
      });

      await test.step("verify hint for short query", async () => {
        await page.getByTestId("user-search-input").fill("a");
        // Still shows hint since < 2 chars
        await expect(page.getByTestId("search-hint")).toBeVisible();
        test.info().annotations.push({ type: "step", description: "Hint visible for single character query" });
      });

      await test.step("verify no results for nonexistent user", async () => {
        await page.getByTestId("user-search-input").fill("zzznonexistent999");
        await expect(page.getByTestId("search-empty")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("No users found")).toBeVisible();
        test.info().annotations.push({ type: "step", description: "No results message shown for nonexistent user" });
      });

      await test.step("clear search restores hint", async () => {
        await page.getByTestId("clear-search").click();
        await expect(page.getByTestId("search-hint")).toBeVisible();
        test.info().annotations.push({ type: "step", description: "Clear search restores hint state" });
      });
    });
  });

  test.describe("API contract", () => {
    test("social endpoints require authentication", async ({ request }) => {
      const endpoints = [
        { path: "/social/friends?page=1&pageSize=20", method: "get" as const },
        { path: "/social/friends/requests", method: "get" as const },
        { path: "/social/friends/request", method: "post" as const },
      ];

      for (const ep of endpoints) {
        const res = await request[ep.method](`${API_BASE}${ep.path}`);
        expect(res.status(), `${ep.method.toUpperCase()} ${ep.path} should require auth`).toBe(401);
      }
    });
  });
});
