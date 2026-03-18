import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authDir = path.join(__dirname, "..", ".auth");
const authFile = path.join(authDir, "user.json");

const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e-user@winzy.test";
const TEST_USERNAME = process.env.E2E_USER_USERNAME ?? "e2e-user";
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD ?? "TestPassword123!";
const API_BASE = process.env.API_URL ?? "http://localhost:5050";

/**
 * Auth setup project.
 *
 * Logs in with the test user and saves the authenticated storageState.
 * If the user doesn't exist yet (401), registers them first via API,
 * then retries login through the UI.
 * Fails loudly if auth cannot be established — downstream tests require a valid session.
 */
setup("authenticate", async ({ page, request }) => {
  fs.mkdirSync(authDir, { recursive: true });

  await page.goto("/");

  try {
    // Wait for auth screen to load
    await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Email or username").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // After login we may land on Today, WelcomeScreen, or a login error.
    const todayLocator = page.getByTestId("today-empty").or(page.getByTestId("today-screen"));
    const welcomeLocator = page.getByText("Welcome to Winzy");

    /** Dismiss WelcomeScreen if present, then wait for Today. */
    async function waitForToday() {
      const result = await Promise.race([
        todayLocator.waitFor({ timeout: 10_000 }).then(() => "today" as const),
        welcomeLocator.waitFor({ timeout: 10_000 }).then(() => "welcome" as const),
      ]);
      if (result === "welcome") {
        // Dismiss the welcome screen (button text "Let's go", may be curly quote)
        const letsGo = page.getByText("Let\u2019s go").or(page.getByText("Let's go")).first();
        await letsGo.click();
        await expect(todayLocator).toBeVisible({ timeout: 10_000 });
      }
    }

    try {
      await waitForToday();
    } catch {
      // Login failed — user probably doesn't exist. Register via API and retry.
      console.log("[auth.setup] Login failed, registering test user via API...");
      const res = await request.post(`${API_BASE}/auth/register`, {
        data: {
          email: TEST_EMAIL,
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
          displayName: "E2E Test User",
        },
      });

      if (res.status() === 201 || res.status() === 409) {
        // 201 = registered, 409 = already exists — either way, retry login
        console.log(`[auth.setup] Registration response: ${res.status()}, retrying login...`);
        await page.goto("/");
        await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
        await page.getByLabel("Email or username").fill(TEST_EMAIL);
        await page.getByLabel("Password").fill(TEST_PASSWORD);
        await page.getByRole("button", { name: "Sign in" }).click();
        await waitForToday();
      } else {
        throw new Error(`[auth.setup] Registration failed with status ${res.status()}`);
      }
    }

    // Save authenticated state
    await page.context().storageState({ path: authFile });
  } catch (error) {
    // Fail loudly so the entire suite stops early with a clear message.
    // Previously this saved empty state, which let downstream tests run
    // unauthenticated — silently passing when they shouldn't.
    // Use { cause } to preserve the original stack trace in Playwright's output.
    throw new Error(
      `[auth.setup] Authentication failed — aborting test suite. ` +
      `All downstream tests depend on a valid session.`,
      { cause: error },
    );
  }
});
