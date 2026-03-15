import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";
import type { Page } from "@playwright/test";

/**
 * Habit Templates E2E tests.
 *
 * Covers: template picker visibility, template selection pre-fills form,
 * customizing template fields before save, skipping templates for custom habit.
 *
 * Each test registers a fresh user to avoid cross-test state pollution.
 */

/** Helper: register + complete profile, lands on Today empty state. */
async function registerAndSetup(page: Page, prefix: string) {
  const uniqueUser = `e2e_tpl_${prefix}_${Date.now()}`;
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

/** Helper: navigate from Today to HabitListScreen and open the create modal. */
async function openCreateModal(page: Page) {
  await page.getByText("Create your first habit").click();
  await expect(page.getByTestId("habit-list-screen")).toBeVisible({ timeout: 10_000 });

  const emptyCta = page.getByText("Create your first habit");
  if (await emptyCta.isVisible().catch(() => false)) {
    await emptyCta.click();
  }
}

test.describe("Habit Templates", () => {
  test("navigate to create habit — see template picker", async ({ unauthenticatedPage: page }) => {
    await test.step("register and complete profile", async () => {
      await registerAndSetup(page, "tplshow");
      test.info().annotations.push({
        type: "step",
        description: "Registered user and landed on Today empty state",
      });
    });

    await test.step("open create habit modal", async () => {
      await openCreateModal(page);
      test.info().annotations.push({
        type: "step",
        description: "Create habit modal opened",
      });
    });

    await test.step("verify template picker is visible with categories", async () => {
      await expect(page.getByTestId("template-picker")).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText("Start with a template")).toBeVisible();
      await expect(page.getByTestId("template-tab-health")).toBeVisible();
      await expect(page.getByTestId("template-tab-productivity")).toBeVisible();
      await expect(page.getByTestId("template-tab-wellness")).toBeVisible();
      await expect(page.getByTestId("template-tab-social")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Template picker visible with all 4 category tabs",
      });
    });

    await test.step("verify form is not yet visible", async () => {
      await expect(page.getByLabel("Habit name")).not.toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Habit form is hidden while template picker is showing",
      });
    });
  });

  test("select a template — verify form pre-fills with template data", async ({ unauthenticatedPage: page }) => {
    await test.step("register and open create modal", async () => {
      await registerAndSetup(page, "tplsel");
      await openCreateModal(page);
      test.info().annotations.push({
        type: "step",
        description: "Create habit modal opened with template picker",
      });
    });

    await test.step("select Meditation template from Health category", async () => {
      await expect(page.getByTestId("template-picker")).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("template-meditation").click();
      test.info().annotations.push({
        type: "step",
        description: "Clicked Meditation template",
      });
    });

    await test.step("verify form is pre-filled with template data", async () => {
      await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
      await expect(page.getByLabel("Habit name")).toHaveValue("Meditation");
      // Template picker should be gone
      await expect(page.getByTestId("template-picker")).not.toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Form pre-filled with Meditation template: name='Meditation'",
      });
    });
  });

  test("customize the name from template — save — verify habit appears with customized name", async ({ unauthenticatedPage: page }) => {
    const customName = "Morning meditation session";

    await test.step("register and open create modal", async () => {
      await registerAndSetup(page, "tplcust");
      await openCreateModal(page);
      test.info().annotations.push({
        type: "step",
        description: "Create habit modal opened with template picker",
      });
    });

    await test.step("select Meditation template", async () => {
      await expect(page.getByTestId("template-picker")).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("template-meditation").click();
      await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
      test.info().annotations.push({
        type: "step",
        description: "Selected Meditation template, form visible",
      });
    });

    await test.step("customize the name and save", async () => {
      await page.getByLabel("Habit name").clear();
      await page.getByLabel("Habit name").fill(customName);
      await page.getByRole("button", { name: "Create habit" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Changed name to "${customName}" and submitted`,
      });
    });

    await test.step("verify habit appears with customized name", async () => {
      // Wait for modal to close and habit to appear in the list
      await expect(page.getByLabel("Habit name")).not.toBeVisible({ timeout: 10_000 });
      // Dismiss FlameIntroModal if it appears (first habit)
      const gotIt = page.getByRole("button", { name: "Got it" });
      try {
        await gotIt.waitFor({ state: "visible", timeout: 2_000 });
        await gotIt.click();
      } catch {
        // Not shown
      }
      await expect(page.getByText(customName)).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: `Habit "${customName}" visible in habit list`,
      });
    });
  });

  test("skip templates — create fully custom habit", async ({ unauthenticatedPage: page }) => {
    const customHabit = "Walk the dog";

    await test.step("register and open create modal", async () => {
      await registerAndSetup(page, "tplskip");
      await openCreateModal(page);
      test.info().annotations.push({
        type: "step",
        description: "Create habit modal opened with template picker",
      });
    });

    await test.step("skip template picker", async () => {
      await expect(page.getByTestId("template-picker")).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("template-skip").click();
      test.info().annotations.push({
        type: "step",
        description: "Clicked 'Create custom habit' to skip templates",
      });
    });

    await test.step("verify empty form is shown", async () => {
      await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
      await expect(page.getByLabel("Habit name")).toHaveValue("");
      await expect(page.getByTestId("template-picker")).not.toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Empty create form visible (no pre-filled data)",
      });
    });

    await test.step("create a fully custom habit", async () => {
      await page.getByLabel("Habit name").fill(customHabit);
      await page.getByRole("button", { name: "Create habit" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Submitted custom habit: ${customHabit}`,
      });
    });

    await test.step("verify custom habit appears in list", async () => {
      await expect(page.getByLabel("Habit name")).not.toBeVisible({ timeout: 10_000 });
      // Dismiss FlameIntroModal if it appears
      const gotIt = page.getByRole("button", { name: "Got it" });
      try {
        await gotIt.waitFor({ state: "visible", timeout: 2_000 });
        await gotIt.click();
      } catch {
        // Not shown
      }
      await expect(page.getByText(customHabit)).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: `Custom habit "${customHabit}" visible in habit list`,
      });
    });
  });
});
