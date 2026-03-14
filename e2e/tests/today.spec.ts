import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";

test.describe("Today screen", () => {
  test("first habit completion journey", async ({ unauthenticatedPage: page }) => {
    const uniqueUser = `e2e_today_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;
    const displayName = "Today Tester";
    const habitName = "Morning run";

    await test.step("register a new account", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Sign up" }).click();
      await expect(page.getByText("Create your account")).toBeVisible();

      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Username").fill(uniqueUser);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Registered: ${uniqueUser}`,
      });
    });

    await test.step("complete profile", async () => {
      await expect(page.getByText("What should we call you?")).toBeVisible({
        timeout: 10_000,
      });
      await page.getByLabel("Display name").fill(displayName);
      await page.getByRole("button", { name: "Continue" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Profile completed: ${displayName}`,
      });
    });

    await test.step("verify Today screen empty state", async () => {
      await dismissWelcomeIfPresent(page);
      await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Ready to build a habit?")).toBeVisible();
      await expect(
        page.getByText("Small daily actions lead to big changes. Start with one habit and watch your flame grow."),
      ).toBeVisible();
      await expect(page.getByText("Create your first habit")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Today screen empty state displayed with encouraging CTA",
      });
    });

    await test.step("navigate to create habit", async () => {
      await page.getByText("Create your first habit").click();
      test.info().annotations.push({
        type: "step",
        description: "Navigated to habit creation",
      });
    });

    await test.step("create a habit", async () => {
      // Wait for the create habit modal/screen to appear
      await expect(page.getByText("New Habit").or(page.getByText("My Habits"))).toBeVisible({
        timeout: 10_000,
      });

      // If we landed on HabitListScreen, click the create button
      const newButton = page.getByText("Create your first habit");
      if (await newButton.isVisible().catch(() => false)) {
        await newButton.click();
      }

      // Fill in the habit name
      await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
      await page.getByLabel("Habit name").fill(habitName);
      await page.getByRole("button", { name: "Create habit" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Created habit: ${habitName}`,
      });
    });

    await test.step("verify habit appears in list", async () => {
      // After creation, we should see the habit in the list
      await expect(page.getByText(habitName)).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: `Habit "${habitName}" visible in list`,
      });
    });
  });
});
