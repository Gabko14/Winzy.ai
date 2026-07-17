import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";
import type { Page } from "@playwright/test";

/**
 * Week strip on Today — toggle a past day and assert it persists after reload.
 * Written for winzy.ai-rs2n; do not run without PM GO (E2E lane).
 */

async function registerAndSetup(page: Page, prefix: string) {
  const uniqueUser = `e2e_week_${prefix}_${Date.now()}`;
  const email = `${uniqueUser}@winzy.test`;

  await page.goto("/");
  await dismissWelcomeIfPresent(page);
  await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Create your account")).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(uniqueUser);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("What should we call you?")).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("Display name").fill(`${prefix} Tester`);
  await page.getByRole("button", { name: "Continue" }).click();

  await dismissWelcomeIfPresent(page);
  await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
}

async function openCreateModal(page: Page) {
  await page.getByText("Create your first habit").click();

  const emptyCta = page.getByText("Create your first habit");
  if (await emptyCta.isVisible().catch(() => false)) {
    await emptyCta.click();
  }

  const skipBtn = page.getByTestId("template-skip");
  try {
    await skipBtn.waitFor({ state: "visible", timeout: 3_000 });
    await skipBtn.click();
  } catch {
    // Template picker not shown
  }

  await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
}

function localYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test.describe("Week strip on Today", () => {
  test("toggle a past day from Today and persist after reload", async ({
    unauthenticatedPage: page,
  }) => {
    const habitName = "Week strip habit";
    const yesterday = localYesterdayISO();

    await test.step("register and create a daily habit", async () => {
      await registerAndSetup(page, "strip");
      await openCreateModal(page);
      await page.getByLabel("Habit name").fill(habitName);
      await page.getByRole("button", { name: "Create habit" }).click();
      await expect(page.getByLabel("Habit name")).not.toBeVisible({ timeout: 10_000 });

      const gotIt = page.getByRole("button", { name: "Got it" });
      try {
        await gotIt.waitFor({ state: "visible", timeout: 2_000 });
        await gotIt.click();
      } catch {
        // Flame intro not shown
      }

      await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(habitName)).toBeVisible({ timeout: 10_000 });
    });

    await test.step("toggle yesterday on the week strip", async () => {
      const habitRow = page.getByText(habitName).locator("xpath=ancestor::*[@data-testid][1]");
      // Habit id is in testIDs; discover strip via week-strip-* prefix
      const strip = page.locator('[data-testid^="week-strip-"]').first();
      await expect(strip).toBeVisible({ timeout: 10_000 });

      const habitIdAttr = await strip.getAttribute("data-testid");
      const habitId = habitIdAttr?.replace("week-strip-", "") ?? "";
      expect(habitId.length).toBeGreaterThan(0);

      const cell = page.getByTestId(`week-cell-${habitId}-${yesterday}`);
      await expect(cell).toBeVisible();
      await cell.click();

      await expect(page.getByTestId("undo-chip")).toBeVisible({ timeout: 5_000 });
      await expect(cell).toHaveAttribute("aria-label", /completed/);

      // Silence unused — habit row presence already asserted
      void habitRow;
    });

    await test.step("reload and assert yesterday still completed", async () => {
      await page.reload();
      await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: 15_000 });

      const strip = page.locator('[data-testid^="week-strip-"]').first();
      await expect(strip).toBeVisible({ timeout: 10_000 });
      const habitIdAttr = await strip.getAttribute("data-testid");
      const habitId = habitIdAttr?.replace("week-strip-", "") ?? "";

      const cell = page.getByTestId(`week-cell-${habitId}-${yesterday}`);
      await expect(cell).toHaveAttribute("aria-label", /completed/, { timeout: 10_000 });
    });
  });
});
