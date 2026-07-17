import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";
import type { Page } from "@playwright/test";

/**
 * Todos on Today — quick-add then complete.
 * Written for winzy.ai-30sf.2; do not run without PM GO (E2E lane).
 */

async function registerAndSetup(page: Page, prefix: string) {
  const uniqueUser = `e2e_todo_${prefix}_${Date.now()}`;
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

test.describe("Todos on Today", () => {
  test("quick-add a todo and complete it", async ({ unauthenticatedPage: page }) => {
    const title = `Todo ${Date.now()}`;

    await test.step("register and land on Today", async () => {
      await registerAndSetup(page, "today");
    });

    await test.step("reveal and quick-add undated todo", async () => {
      await page.getByTestId("todos-reveal-button").click();
      await expect(page.getByTestId("today-todos-section")).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId("todos-quick-add");
      await input.pressSequentially(title);
      await input.press("Enter");
      await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
    });

    await test.step("complete the todo", async () => {
      const row = page.locator('[data-testid^="todo-row-"]').filter({ hasText: title });
      await expect(row).toBeVisible();
      const toggle = row.locator('[data-testid^="todo-toggle-"]');
      await toggle.click();
      await expect(page.getByText(title)).toBeHidden({ timeout: 5_000 });
    });

    await test.step("reload — completed todo stays off Today", async () => {
      await page.reload();
      await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(title)).not.toBeVisible();
    });
  });
});
