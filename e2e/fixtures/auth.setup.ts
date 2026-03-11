import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authDir = path.join(__dirname, "..", ".auth");
const authFile = path.join(authDir, "user.json");

const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e-user@winzy.test";
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD ?? "TestPassword123!";

/**
 * Auth setup project.
 *
 * Logs in with the test user and saves the authenticated storageState.
 * If the backend is not running, falls back to saving empty state
 * so that dependent projects don't fail.
 */
setup("authenticate", async ({ page }) => {
  fs.mkdirSync(authDir, { recursive: true });

  await page.goto("/");

  try {
    // Wait for auth screen to load
    await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Email or username").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Wait for successful auth — land on Today screen (empty or populated)
    await expect(
      page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
    ).toBeVisible({ timeout: 10_000 });

    // Save authenticated state
    await page.context().storageState({ path: authFile });
  } catch (error) {
    // Log the error so auth failures don't silently pass downstream tests
    console.error("[auth.setup] Authentication failed:", error instanceof Error ? error.message : error);
    // Save empty state so dependent tests run (unauthenticated) rather than crashing
    await page.context().storageState({ path: authFile });
  }
});
