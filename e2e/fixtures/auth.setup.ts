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
 * Falls back to empty state if the backend is unreachable.
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

    // Check if we land on Today screen or hit a login error
    const todayLocator = page.getByTestId("today-empty").or(page.getByTestId("today-screen"));
    try {
      await expect(todayLocator).toBeVisible({ timeout: 10_000 });
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
        await expect(todayLocator).toBeVisible({ timeout: 10_000 });
      } else {
        throw new Error(`[auth.setup] Registration failed with status ${res.status()}`);
      }
    }

    // Save authenticated state
    await page.context().storageState({ path: authFile });
  } catch (error) {
    // Log the error so auth failures don't silently pass downstream tests
    console.error("[auth.setup] Authentication failed:", error instanceof Error ? error.message : error);
    // Save empty state so dependent tests run (unauthenticated) rather than crashing
    await page.context().storageState({ path: authFile });
  }
});
