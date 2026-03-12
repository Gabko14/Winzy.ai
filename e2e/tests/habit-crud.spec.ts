import { test, expect, TEST_USER } from "../fixtures/base";
import type { Page } from "@playwright/test";

/**
 * Habit CRUD E2E tests.
 *
 * Covers: create, edit, archive, validation, custom frequency,
 * and multi-habit list behavior.
 *
 * Each test registers a fresh user to avoid cross-test state pollution.
 */

/** Helper: register + complete profile, lands on Today empty state. */
async function registerAndSetup(page: Page, prefix: string) {
  const uniqueUser = `e2e_habit_${prefix}_${Date.now()}`;
  const email = `${uniqueUser}@winzy.test`;

  await page.goto("/");
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

  await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
}

/** Helper: navigate from Today empty state to HabitListScreen and open the create modal. */
async function openCreateModal(page: Page) {
  // Today empty CTA navigates to HabitListScreen
  await page.getByText("Create your first habit").click();

  // HabitListScreen renders — either empty state or the list header
  await expect(
    page.getByText("My Habits").or(page.getByText("No habits yet")),
  ).toBeVisible({ timeout: 10_000 });

  // If the habit list is empty, click the empty-state CTA to open the modal
  const emptyCta = page.getByText("Create your first habit");
  if (await emptyCta.isVisible().catch(() => false)) {
    await emptyCta.click();
  }

  // Wait for the create habit modal
  await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
}

/** Helper: create a habit with the given name from the open modal. */
async function createHabit(page: Page, name: string) {
  await page.getByLabel("Habit name").fill(name);
  await page.getByRole("button", { name: "Create habit" }).click();

  // Wait for modal to close and habit to appear in the list
  await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
}

test.describe("Habit CRUD", () => {
  test("create a habit end-to-end", async ({ unauthenticatedPage: page }) => {
    const habitName = "Morning meditation";

    await test.step("register and complete profile", async () => {
      await registerAndSetup(page, "create");
      test.info().annotations.push({
        type: "step",
        description: "Registered user and landed on Today empty state",
      });
    });

    await test.step("navigate to create habit", async () => {
      await openCreateModal(page);
      test.info().annotations.push({
        type: "step",
        description: "Create habit modal opened",
      });
    });

    await test.step("fill and submit habit form", async () => {
      await page.getByLabel("Habit name").fill(habitName);
      await page.getByRole("button", { name: "Create habit" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Submitted habit: ${habitName}`,
      });
    });

    await test.step("verify habit appears in list", async () => {
      await expect(page.getByText(habitName)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("habit-list-screen")).toBeVisible();
      await expect(page.getByText("My Habits")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: `Habit "${habitName}" visible in habit list`,
      });
    });
  });

  test("edit an existing habit", async ({ unauthenticatedPage: page }) => {
    const originalName = "Read a book";
    const updatedName = "Read for 30 minutes";

    await test.step("register and create initial habit", async () => {
      await registerAndSetup(page, "edit");
      await openCreateModal(page);
      await createHabit(page, originalName);
      test.info().annotations.push({
        type: "step",
        description: `Created habit: ${originalName}`,
      });
    });

    await test.step("open habit for editing", async () => {
      // Click on the habit row to open edit modal
      await page.getByText(originalName).click();
      await expect(page.getByText("Edit Habit")).toBeVisible({ timeout: 5_000 });
      await expect(page.getByLabel("Habit name")).toHaveValue(originalName);
      test.info().annotations.push({
        type: "step",
        description: "Edit modal opened with existing habit data",
      });
    });

    await test.step("update habit name and save", async () => {
      await page.getByLabel("Habit name").clear();
      await page.getByLabel("Habit name").fill(updatedName);
      await page.getByRole("button", { name: "Save changes" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Updated habit name to: ${updatedName}`,
      });
    });

    await test.step("verify updated name in list", async () => {
      await expect(page.getByText(updatedName)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(originalName)).not.toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: `Habit list shows updated name "${updatedName}"`,
      });
    });
  });

  test("archive a habit", async ({ unauthenticatedPage: page }) => {
    const habitName = "Evening walk";

    await test.step("register and create habit", async () => {
      await registerAndSetup(page, "archive");
      await openCreateModal(page);
      await createHabit(page, habitName);
      test.info().annotations.push({
        type: "step",
        description: `Created habit: ${habitName}`,
      });
    });

    await test.step("archive the habit via the X button", async () => {
      // Set up dialog handler before triggering (web uses window.confirm)
      page.on("dialog", (dialog) => dialog.accept());

      // Click the archive (X) button — find by accessibility label
      await page.getByRole("button", { name: `Archive ${habitName}` }).click();
      test.info().annotations.push({
        type: "step",
        description: `Triggered archive for: ${habitName}`,
      });
    });

    await test.step("verify habit is removed from list", async () => {
      await expect(page.getByText(habitName)).not.toBeVisible({ timeout: 10_000 });
      // Should show empty state again since this was the only habit
      await expect(page.getByText("No habits yet")).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: "Habit removed, empty state displayed",
      });
    });
  });

  test("create habit validation — empty name", async ({ unauthenticatedPage: page }) => {
    await test.step("register and open create modal", async () => {
      await registerAndSetup(page, "validation");
      await openCreateModal(page);
      test.info().annotations.push({
        type: "step",
        description: "Create habit modal opened",
      });
    });

    await test.step("submit without entering a name", async () => {
      // Clear the name field (it should already be empty, but be explicit)
      await page.getByLabel("Habit name").fill("");
      await page.getByRole("button", { name: "Create habit" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Submitted empty habit form",
      });
    });

    await test.step("verify validation error", async () => {
      await expect(page.getByText("Habit name is required.")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Validation error displayed for empty name",
      });
    });

    await test.step("fix the error and create successfully", async () => {
      await page.getByLabel("Habit name").fill("Fixed habit");
      await page.getByRole("button", { name: "Create habit" }).click();
      await expect(page.getByText("Fixed habit")).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: "Habit created after fixing validation error",
      });
    });
  });

  test("create habit with custom frequency", async ({ unauthenticatedPage: page }) => {
    const habitName = "Weekend yoga";

    await test.step("register and open create modal", async () => {
      await registerAndSetup(page, "custom");
      await openCreateModal(page);
      test.info().annotations.push({
        type: "step",
        description: "Create habit modal opened",
      });
    });

    await test.step("fill name and select custom frequency", async () => {
      await page.getByLabel("Habit name").fill(habitName);

      // Select "Custom" frequency
      await page.getByTestId("freq-custom").click();
      test.info().annotations.push({
        type: "step",
        description: "Selected custom frequency",
      });
    });

    await test.step("submit without selecting days — verify validation", async () => {
      await page.getByRole("button", { name: "Create habit" }).click();
      await expect(page.getByText("Select at least one day for custom frequency.")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Custom days validation error displayed",
      });
    });

    await test.step("select days and submit", async () => {
      // Select Saturday and Sunday
      await page.getByTestId("day-Sat").click();
      await page.getByTestId("day-Sun").click();
      await page.getByRole("button", { name: "Create habit" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Selected Sat + Sun and submitted",
      });
    });

    await test.step("verify habit appears with custom frequency", async () => {
      await expect(page.getByText(habitName)).toBeVisible({ timeout: 10_000 });
      // The habit list shows formatted frequency: "Sat, Sun"
      await expect(page.getByText("Sat, Sun")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: `Habit "${habitName}" visible with Sat, Sun frequency`,
      });
    });
  });

  test("create multiple habits", async ({ unauthenticatedPage: page }) => {
    const habit1 = "Drink water";
    const habit2 = "Stretch";

    await test.step("register and create first habit", async () => {
      await registerAndSetup(page, "multi");
      await openCreateModal(page);
      await createHabit(page, habit1);
      test.info().annotations.push({
        type: "step",
        description: `Created first habit: ${habit1}`,
      });
    });

    await test.step("verify '+ New' button is visible", async () => {
      // When habits exist, the header shows "+ New" button
      await expect(page.getByRole("button", { name: "Create new habit" })).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "'+ New' button visible in header",
      });
    });

    await test.step("create second habit via '+ New' button", async () => {
      await page.getByRole("button", { name: "Create new habit" }).click();
      await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
      await createHabit(page, habit2);
      test.info().annotations.push({
        type: "step",
        description: `Created second habit: ${habit2}`,
      });
    });

    await test.step("verify both habits appear in list", async () => {
      await expect(page.getByText(habit1)).toBeVisible();
      await expect(page.getByText(habit2)).toBeVisible();
      await expect(page.getByTestId("habits-list")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Both habits visible in the list",
      });
    });
  });
});
