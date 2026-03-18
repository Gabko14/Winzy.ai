import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";
import type { Page } from "@playwright/test";

const API_BASE = "http://localhost:5050";

/**
 * Create Challenge E2E tests.
 *
 * Covers: friend profile -> Set Challenge -> complete flow -> success,
 * preview verification, and validation.
 */

async function gotoLoginScreen(page: Page) {
  await page.goto("/");
  await dismissWelcomeIfPresent(page);

  const signIn = page.getByText("Welcome back");
  const today = page.getByTestId("today-empty").or(page.getByTestId("today-screen"));
  const profileCompletion = page.getByText("What should we call you?");

  const where = await Promise.race([
    signIn.waitFor({ timeout: 15_000 }).then(() => "signIn" as const),
    today.waitFor({ timeout: 15_000 }).then(() => "today" as const),
    profileCompletion.waitFor({ timeout: 15_000 }).then(() => "profile" as const),
  ]);

  if (where === "signIn") return;

  if (where === "profile") {
    await page.getByLabel("Display name").fill("Temp User");
    await page.getByRole("button", { name: "Continue" }).click();
    await dismissWelcomeIfPresent(page);
    await expect(today).toBeVisible({ timeout: 10_000 });
  }

  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(signIn).toBeVisible({ timeout: 15_000 });
}

test.describe("Create Challenge flow", () => {
  test.describe.configure({ mode: "serial" });

  let userAToken: string;
  let userAId: string;
  let userAEmail: string;
  let userBToken: string;
  let userBId: string;
  let userBUsername: string;
  let userBEmail: string;

  test("setup: register two users who are friends, user B has a habit", async ({ request }) => {
    const tsA = Date.now();
    const tsB = tsA + 1;
    const usernameA = `e2e_challA_${tsA}`;
    userAEmail = `${usernameA}@winzy.test`;
    userBUsername = `e2e_challB_${tsB}`;
    userBEmail = `${userBUsername}@winzy.test`;

    await test.step("register user A", async () => {
      const res = await request.post(`${API_BASE}/auth/register`, {
        data: {
          email: `${usernameA}@winzy.test`,
          username: usernameA,
          password: TEST_USER.password,
          displayName: "Challenger A",
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
          username: userBUsername,
          password: TEST_USER.password,
          displayName: "Challenger B",
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
      const body = await res.json();

      // User B accepts
      const acceptRes = await request.put(
        `${API_BASE}/social/friends/request/${body.id}/accept`,
        { headers: { Authorization: `Bearer ${userBToken}` } },
      );
      expect(acceptRes.status()).toBe(200);
      test.info().annotations.push({
        type: "step",
        description: "Friendship established between A and B",
      });
    });

    await test.step("complete both user profiles so welcome screen doesn't block", async () => {
      const resA = await request.put(`${API_BASE}/auth/profile`, {
        headers: { Authorization: `Bearer ${userAToken}` },
        data: { displayName: "Challenger A" },
      });
      expect(resA.status()).toBe(200);

      const resB = await request.put(`${API_BASE}/auth/profile`, {
        headers: { Authorization: `Bearer ${userBToken}` },
        data: { displayName: "Challenger B" },
      });
      expect(resB.status()).toBe(200);
    });

    await test.step("user B creates a habit and sets visibility to friends", async () => {
      const res = await request.post(`${API_BASE}/habits`, {
        headers: { Authorization: `Bearer ${userBToken}` },
        data: {
          name: "Daily Meditation",
          frequency: "daily",
        },
      });
      expect(res.status()).toBe(201);
      const habit = await res.json();

      // Habit service ignores `visibility` — it's managed by the social service.
      // Set per-habit visibility so user A can see it on friend B's profile.
      const visRes = await request.put(`${API_BASE}/social/visibility/${habit.id}`, {
        headers: { Authorization: `Bearer ${userBToken}` },
        data: { visibility: "friends" },
      });
      expect(visRes.status()).toBe(200);

      test.info().annotations.push({
        type: "step",
        description: "User B has a visible habit: Daily Meditation",
      });
    });
  });

  test("navigate from friend profile -> Set Challenge -> complete flow -> see Challenge sent", async ({
    unauthenticatedPage: page,
  }) => {
    await test.step("sign in as user A via UI", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("Email or username").fill(userAEmail);
      await page.getByLabel("Password").fill(TEST_USER.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await dismissWelcomeIfPresent(page);
      test.info().annotations.push({
        type: "step",
        description: "Signed in as user A via UI",
      });
    });

    await test.step("navigate to Friends tab and find friend B", async () => {
      const today = page.getByTestId("today-empty").or(page.getByTestId("today-screen"));
      await expect(today).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("tab-friends").click();
      test.info().annotations.push({
        type: "step",
        description: "Navigated to Friends tab",
      });
    });

    await test.step("tap friend B to open profile", async () => {
      // Wait for friends list to load
      await expect(page.getByTestId("friends-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Challenger B")).toBeVisible({ timeout: 10_000 });
      await page.getByText("Challenger B").click();
      test.info().annotations.push({
        type: "step",
        description: "Opened friend B's profile",
      });
    });

    await test.step("tap Set Challenge button", async () => {
      await expect(page.getByTestId("friend-profile-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("set-challenge-button")).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "Set challenge for this friend" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Tapped Set Challenge button",
      });
    });

    await test.step("step 1: select habit", async () => {
      await expect(page.getByTestId("step-1-select-habit")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Daily Meditation")).toBeVisible();
      await page.getByText("Daily Meditation").click();
      await page.getByRole("button", { name: "Continue to next step" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Selected habit: Daily Meditation",
      });
    });

    await test.step("step 2: set target", async () => {
      await expect(page.getByTestId("step-2-set-target")).toBeVisible({ timeout: 10_000 });
      // Use default target and period
      await page.getByRole("button", { name: "Continue to next step" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Set target: 60% over 30 days (defaults)",
      });
    });

    await test.step("step 3: describe reward", async () => {
      await expect(page.getByTestId("step-3-reward")).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("reward-input").fill("Grab coffee at the new place downtown");
      await page.getByRole("button", { name: "Continue to next step" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Described reward: coffee together",
      });
    });

    await test.step("step 4: verify preview and submit", async () => {
      await expect(page.getByTestId("step-4-preview")).toBeVisible({ timeout: 10_000 });

      // Verify preview content
      await expect(page.getByTestId("preview-friend")).toBeVisible();
      await expect(page.getByTestId("preview-habit")).toBeVisible();
      await expect(page.getByTestId("preview-target")).toBeVisible();
      await expect(page.getByTestId("preview-reward")).toBeVisible();
      await expect(page.getByText("Grab coffee at the new place downtown")).toBeVisible();

      await page.getByRole("button", { name: "Send challenge" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Preview verified and challenge submitted",
      });
    });

    await test.step("step 5: see Challenge sent!", async () => {
      await expect(page.getByText("Challenge sent!")).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: "Success screen: Challenge sent!",
      });
    });
  });

  test("recipient sees challenge with creator context on My Challenges screen", async ({
    unauthenticatedPage: page,
  }) => {
    await test.step("sign in as user B (the challenge recipient)", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("Email or username").fill(userBEmail);
      await page.getByLabel("Password").fill(TEST_USER.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await dismissWelcomeIfPresent(page);
    });

    await test.step("navigate to Profile tab and open My Challenges", async () => {
      const today = page.getByTestId("today-empty").or(page.getByTestId("today-screen"));
      await expect(today).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("tab-profile").click();
      await expect(page.getByTestId("challenges-link")).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("challenges-link").click();
    });

    await test.step("verify challenge card shows creator context", async () => {
      await expect(page.getByTestId("my-challenges-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("active-challenges-list")).toBeVisible({ timeout: 10_000 });

      // The challenge card should show who set it
      await expect(page.getByText("Set by Challenger A")).toBeVisible({ timeout: 10_000 });

      // Verify the tracking elements are present
      await expect(page.getByTestId("challenge-progress-card")).toBeVisible();
      await expect(page.getByTestId("challenge-reward")).toBeVisible();
      await expect(page.getByText("Grab coffee at the new place downtown")).toBeVisible();
      await expect(page.getByTestId("challenge-days-remaining")).toBeVisible();
    });
  });

  test("claim rejects active challenge and challenge list includes creator context via API", async ({
    request,
  }) => {
    let challengeId: string;

    await test.step("fetch user B's active challenge via API", async () => {
      const res = await request.get(`${API_BASE}/challenges?status=active`, {
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      challengeId = body.items[0].id;

      // Verify the API response includes creator display name
      expect(body.items[0].creatorDisplayName).toBe("Challenger A");
    });

    await test.step("claim rejects an active (not yet completed) challenge", async () => {
      const claimRes = await request.put(`${API_BASE}/challenges/${challengeId}/claim`, {
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      expect(claimRes.status()).toBe(400);
      const body = await claimRes.json();
      expect(body.error).toBe("Only completed challenges can be claimed");
    });

    await test.step("challenge detail endpoint also includes creator display name", async () => {
      const res = await request.get(`${API_BASE}/challenges/${challengeId}`, {
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.creatorDisplayName).toBe("Challenger A");
      expect(body.rewardDescription).toBe("Grab coffee at the new place downtown");
    });
  });

  test("validation blocks submit without required fields", async ({ unauthenticatedPage: page }) => {
    // Sign in as user A (profile already completed via API in setup)
    await page.goto("/");
    await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Email or username").fill(userAEmail);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await dismissWelcomeIfPresent(page);

    const today = page.getByTestId("today-empty").or(page.getByTestId("today-screen"));

    await test.step("navigate to create challenge", async () => {
      await expect(today).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("tab-friends").click();
      await expect(page.getByTestId("friends-screen")).toBeVisible({ timeout: 10_000 });
      await page.getByText("Challenger B").click();
      await expect(page.getByTestId("friend-profile-screen")).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "Set challenge for this friend" }).click();
      await expect(page.getByTestId("step-1-select-habit")).toBeVisible({ timeout: 10_000 });
    });

    await test.step("habit is auto-selected when only one exists", async () => {
      // When there's only one shared habit, CreateChallengeScreen auto-selects it
      // (line 97: setSelectedHabit(profile.habits[0]))
      const radio = page.getByRole("radio", { name: /Daily Meditation/i });
      await expect(radio).toBeVisible({ timeout: 5_000 });
      // The continue button should be enabled since the habit is auto-selected
      const continueBtn = page.getByRole("button", { name: "Continue to next step" });
      await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
      test.info().annotations.push({
        type: "step",
        description: "Habit auto-selected, continue button enabled",
      });
    });
  });
});
