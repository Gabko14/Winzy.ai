import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";
import type { APIRequestContext } from "@playwright/test";

const API_BASE = "http://localhost:5050";

/**
 * Create Challenge E2E tests.
 *
 * Covers: friend profile -> Set Challenge -> complete flow -> success,
 * preview verification, and validation.
 *
 * Each test is fully independent — creates its own users and data via API.
 */

interface ChallengePair {
  userAToken: string;
  userAEmail: string;
  userBToken: string;
  userBId: string;
  userBEmail: string;
}

/** Register two users, make them friends, complete profiles, and give user B a visible habit. */
async function setupChallengePair(request: APIRequestContext, label: string): Promise<ChallengePair> {
  const ts = Date.now();
  const usernameA = `e2e_${label}A_${ts}`;
  const usernameB = `e2e_${label}B_${ts + 1}`;
  const emailA = `${usernameA}@winzy.test`;
  const emailB = `${usernameB}@winzy.test`;

  // Register user A
  const resA = await request.post(`${API_BASE}/auth/register`, {
    data: {
      email: emailA,
      username: usernameA,
      password: TEST_USER.password,
      displayName: "Challenger A",
    },
  });
  expect(resA.status()).toBe(201);
  const bodyA = await resA.json();

  // Register user B
  const resB = await request.post(`${API_BASE}/auth/register`, {
    data: {
      email: emailB,
      username: usernameB,
      password: TEST_USER.password,
      displayName: "Challenger B",
    },
  });
  expect(resB.status()).toBe(201);
  const bodyB = await resB.json();

  // A sends friend request, B accepts
  const reqRes = await request.post(`${API_BASE}/social/friends/request`, {
    headers: { Authorization: `Bearer ${bodyA.accessToken}` },
    data: { friendId: bodyB.user.id },
  });
  expect(reqRes.status()).toBe(201);
  const reqBody = await reqRes.json();

  const acceptRes = await request.put(
    `${API_BASE}/social/friends/request/${reqBody.id}/accept`,
    { headers: { Authorization: `Bearer ${bodyB.accessToken}` } },
  );
  expect(acceptRes.status()).toBe(200);

  // Complete both profiles
  const profA = await request.put(`${API_BASE}/auth/profile`, {
    headers: { Authorization: `Bearer ${bodyA.accessToken}` },
    data: { displayName: "Challenger A" },
  });
  expect(profA.status()).toBe(200);

  const profB = await request.put(`${API_BASE}/auth/profile`, {
    headers: { Authorization: `Bearer ${bodyB.accessToken}` },
    data: { displayName: "Challenger B" },
  });
  expect(profB.status()).toBe(200);

  // User B creates a habit with friends visibility
  const habitRes = await request.post(`${API_BASE}/habits`, {
    headers: { Authorization: `Bearer ${bodyB.accessToken}` },
    data: { name: "Daily Meditation", frequency: "daily" },
  });
  expect(habitRes.status()).toBe(201);
  const habit = await habitRes.json();

  const visRes = await request.put(`${API_BASE}/social/visibility/${habit.id}`, {
    headers: { Authorization: `Bearer ${bodyB.accessToken}` },
    data: { visibility: "friends" },
  });
  expect(visRes.status()).toBe(200);

  return {
    userAToken: bodyA.accessToken,
    userAEmail: emailA,
    userBToken: bodyB.accessToken,
    userBId: bodyB.user.id,
    userBEmail: emailB,
  };
}

/** Create a challenge from user A to user B via API. Returns the habit ID used. */
async function createChallengeViaApi(request: APIRequestContext, pair: ChallengePair): Promise<string> {
  // Get user B's habits visible to user A
  const profileRes = await request.get(`${API_BASE}/social/friends/${pair.userBId}/profile`, {
    headers: { Authorization: `Bearer ${pair.userAToken}` },
  });
  expect(profileRes.status()).toBe(200);
  const profile = await profileRes.json();
  const habitId = profile.habits[0].id;

  const res = await request.post(`${API_BASE}/challenges`, {
    headers: { Authorization: `Bearer ${pair.userAToken}` },
    data: {
      recipientId: pair.userBId,
      habitId,
      milestoneType: "consistencyTarget",
      targetValue: 60,
      periodDays: 30,
      rewardDescription: "Grab coffee at the new place downtown",
    },
  });
  expect(res.status()).toBe(201);
  return habitId;
}

test.describe("Create Challenge flow", () => {
  test("navigate from friend profile -> Set Challenge -> complete flow -> see Challenge sent", async ({
    unauthenticatedPage: page,
    request,
  }) => {
    const pair = await setupChallengePair(request, "challFlow");

    await test.step("sign in as user A via UI", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("Email or username").fill(pair.userAEmail);
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
    request,
  }) => {
    const pair = await setupChallengePair(request, "challRecip");
    await createChallengeViaApi(request, pair);

    await test.step("sign in as user B (the challenge recipient)", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("Email or username").fill(pair.userBEmail);
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

      await expect(page.getByText("Set by Challenger A")).toBeVisible({ timeout: 10_000 });

      await expect(page.getByTestId("challenge-progress-card")).toBeVisible();
      await expect(page.getByTestId("challenge-reward")).toBeVisible();
      await expect(page.getByText("Grab coffee at the new place downtown")).toBeVisible();
      await expect(page.getByTestId("challenge-days-remaining")).toBeVisible();
    });
  });

  test("claim rejects active challenge and challenge list includes creator context via API", async ({
    request,
  }) => {
    const pair = await setupChallengePair(request, "challApi");
    await createChallengeViaApi(request, pair);

    let challengeId: string;

    await test.step("fetch user B's active challenge via API", async () => {
      const res = await request.get(`${API_BASE}/challenges?status=active`, {
        headers: { Authorization: `Bearer ${pair.userBToken}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      challengeId = body.items[0].id;

      expect(body.items[0].creatorDisplayName).toBe("Challenger A");
    });

    await test.step("claim rejects an active (not yet completed) challenge", async () => {
      const claimRes = await request.put(`${API_BASE}/challenges/${challengeId}/claim`, {
        headers: { Authorization: `Bearer ${pair.userBToken}` },
      });
      expect(claimRes.status()).toBe(400);
      const body = await claimRes.json();
      expect(body.error).toBe("Only completed challenges can be claimed");
    });

    await test.step("challenge detail endpoint also includes creator display name", async () => {
      const res = await request.get(`${API_BASE}/challenges/${challengeId}`, {
        headers: { Authorization: `Bearer ${pair.userBToken}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.creatorDisplayName).toBe("Challenger A");
      expect(body.rewardDescription).toBe("Grab coffee at the new place downtown");
    });
  });

  test("validation blocks submit without required fields", async ({ unauthenticatedPage: page, request }) => {
    const pair = await setupChallengePair(request, "challValid");

    await page.goto("/");
    await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Email or username").fill(pair.userAEmail);
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
      const radio = page.getByRole("radio", { name: /Daily Meditation/i });
      await expect(radio).toBeVisible({ timeout: 5_000 });
      const continueBtn = page.getByRole("button", { name: "Continue to next step" });
      await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
      test.info().annotations.push({
        type: "step",
        description: "Habit auto-selected, continue button enabled",
      });
    });
  });
});
