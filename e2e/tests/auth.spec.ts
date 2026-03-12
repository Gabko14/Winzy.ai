import { test, expect, TEST_USER } from "../fixtures/base";

test.describe("Auth flow", () => {
  test("sign up, land in app, and verify session", async ({ unauthenticatedPage: page }) => {
    const uniqueUser = `e2e_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;

    await test.step("navigate to app root", async () => {
      await page.goto("/");
      test.info().annotations.push({ type: "step", description: "Navigated to app root" });
    });

    await test.step("verify sign-in screen is displayed", async () => {
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByLabel("Email or username")).toBeVisible();
      await expect(page.getByLabel("Password")).toBeVisible();
      test.info().annotations.push({ type: "step", description: "Sign-in form rendered" });
    });

    await test.step("navigate to sign-up screen", async () => {
      await page.getByRole("button", { name: "Sign up" }).click();
      await expect(page.getByText("Create your account")).toBeVisible();
      test.info().annotations.push({ type: "step", description: "Navigated to sign-up" });
    });

    await test.step("fill registration form", async () => {
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Username").fill(uniqueUser);
      await page.getByLabel("Password").fill(password);
      test.info().annotations.push({
        type: "step",
        description: `Filled: email=${email}, username=${uniqueUser}`,
      });
    });

    await test.step("submit registration", async () => {
      await page.getByRole("button", { name: "Create account" }).click();
      test.info().annotations.push({ type: "step", description: "Registration submitted" });
    });

    await test.step("verify landing in authenticated app", async () => {
      // After successful registration, new users (no displayName) see profile completion
      await expect(page.getByText("What should we call you?")).toBeVisible({
        timeout: 10_000,
      });
      test.info().annotations.push({
        type: "step",
        description: "User landed in profile completion screen",
      });
    });
  });

  test("sign in with existing credentials", async ({ unauthenticatedPage: page }) => {
    await test.step("navigate to sign-in screen", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      test.info().annotations.push({ type: "step", description: "Sign-in form visible" });
    });

    await test.step("fill credentials", async () => {
      await page.getByLabel("Email or username").fill(TEST_USER.email);
      await page.getByLabel("Password").fill(TEST_USER.password);
      test.info().annotations.push({ type: "step", description: "Credentials filled" });
    });

    await test.step("submit sign in", async () => {
      await page.getByRole("button", { name: "Sign in" }).click();
      test.info().annotations.push({ type: "step", description: "Sign-in submitted" });
    });

    // This test requires a running backend with the test user seeded.
    // It must FAIL if authentication doesn't actually succeed.
    await test.step("verify authenticated landing", async () => {
      await expect(
        page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
      ).toBeVisible({ timeout: 10_000 });

      // Ensure no server error is silently present alongside the screen
      await expect(page.getByTestId("server-error")).not.toBeVisible();

      test.info().annotations.push({
        type: "step",
        description: "User authenticated and landed on Today screen",
      });
    });
  });

  test("client-side validation prevents submission", async ({ unauthenticatedPage: page }) => {
    await test.step("navigate to sign-up", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Sign up" }).click();
      await expect(page.getByText("Create your account")).toBeVisible();
    });

    await test.step("submit empty form", async () => {
      await page.getByRole("button", { name: "Create account" }).click();
      test.info().annotations.push({ type: "step", description: "Submitted empty form" });
    });

    await test.step("verify validation errors are shown", async () => {
      await expect(page.getByText("Email is required.")).toBeVisible();
      await expect(page.getByText("Username is required.")).toBeVisible();
      await expect(page.getByText("Password is required.")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "All three validation errors shown",
      });
    });

    await test.step("fill invalid username and verify specific error", async () => {
      await page.getByLabel("Email").fill("user@test.com");
      await page.getByLabel("Username").fill("ab");
      await page.getByLabel("Password").fill("password123");
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page.getByText("Username must be at least 3 characters.")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Username too-short validation shown",
      });
    });
  });

  test("switch between sign-in and sign-up screens", async ({ unauthenticatedPage: page }) => {
    await test.step("start at sign-in", async () => {
      await page.goto("/");
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
    });

    await test.step("go to sign-up", async () => {
      await page.getByRole("button", { name: "Sign up" }).click();
      await expect(page.getByText("Create your account")).toBeVisible();
    });

    await test.step("go back to sign-in", async () => {
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText("Welcome back")).toBeVisible();
    });
  });
});
