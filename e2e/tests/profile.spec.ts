import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";

test.describe("Profile flow", () => {
  test("new user completes profile after sign-up", async ({ unauthenticatedPage: page }) => {
    const uniqueUser = `e2e_profile_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;
    const displayName = "Profile Tester";

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

    await test.step("verify profile completion screen appears", async () => {
      await expect(page.getByText("What should we call you?")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText("Pick a display name. You can change it later.")).toBeVisible();
      await expect(page.getByLabel("Display name")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Profile completion screen displayed",
      });
    });

    await test.step("enter display name and continue", async () => {
      await page.getByLabel("Display name").fill(displayName);
      await page.getByRole("button", { name: "Continue" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Display name set: ${displayName}`,
      });
    });

    await test.step("verify landing in Today screen", async () => {
      // After profile completion, user lands on the Today screen (empty for new users)
      await dismissWelcomeIfPresent(page);
      await expect(page.getByTestId("today-empty")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText("Ready to build a habit?")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "User landed on Today screen after profile completion",
      });
    });
  });

  test("new user skips profile completion", async ({ unauthenticatedPage: page }) => {
    const uniqueUser = `e2e_skip_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;

    await test.step("register and reach profile completion", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Sign up" }).click();
      await expect(page.getByText("Create your account")).toBeVisible();

      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Username").fill(uniqueUser);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page.getByText("What should we call you?")).toBeVisible({
        timeout: 10_000,
      });
      test.info().annotations.push({
        type: "step",
        description: "Profile completion screen shown",
      });
    });

    await test.step("skip profile completion", async () => {
      await page.getByRole("button", { name: "Skip for now" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Skipped profile completion",
      });
    });

    await test.step("verify landing in Today screen", async () => {
      // After skip, user lands on the Today screen (empty for new users)
      await dismissWelcomeIfPresent(page);
      await expect(page.getByTestId("today-empty")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText("Ready to build a habit?")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "User landed on Today screen after skipping profile completion",
      });
    });
  });

  test("profile completion validates empty display name", async ({
    unauthenticatedPage: page,
  }) => {
    const uniqueUser = `e2e_val_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;

    await test.step("register and reach profile completion", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Sign up" }).click();

      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Username").fill(uniqueUser);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page.getByText("What should we call you?")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("submit empty display name", async () => {
      await page.getByRole("button", { name: "Continue" }).click();
      test.info().annotations.push({
        type: "step",
        description: "Submitted empty display name",
      });
    });

    await test.step("verify validation error", async () => {
      await expect(page.getByText("Please enter a display name.")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Validation error displayed",
      });
    });
  });
});
