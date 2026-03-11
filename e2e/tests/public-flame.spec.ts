import { test, expect, TEST_USER } from "../fixtures/base";

test.describe("Public Flame Page", () => {
  test("shows not-found state for nonexistent username", async ({ unauthenticatedPage: page }) => {
    await test.step("navigate to a nonexistent profile", async () => {
      await page.goto("/@thisuserdoesnotexist999");
      test.info().annotations.push({
        type: "step",
        description: "Navigated to /@thisuserdoesnotexist999",
      });
    });

    await test.step("verify not-found state is displayed", async () => {
      await expect(page.getByText("User not found")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/thisuserdoesnotexist999/)).toBeVisible();
      test.info().annotations.push({ type: "step", description: "Not-found state rendered" });
    });

    await test.step("verify CTA is present", async () => {
      await expect(page.getByText("Create your own flame")).toBeVisible();
      test.info().annotations.push({ type: "step", description: "CTA visible on not-found page" });
    });
  });

  test("loads public profile for a registered user", async ({ unauthenticatedPage: page }) => {
    const uniqueUser = `e2e_flame_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;

    await test.step("register a new user to create a public profile", async () => {
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
        description: `Registered user: ${uniqueUser}`,
      });

      // Wait for auth to complete (profile completion or main app)
      await expect(
        page.getByText("What should we call you?").or(page.getByText(new RegExp(uniqueUser))),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("navigate to the user's public flame page", async () => {
      await page.goto(`/@${uniqueUser}`);
      test.info().annotations.push({
        type: "step",
        description: `Navigated to /@${uniqueUser}`,
      });
    });

    await test.step("verify public profile loads", async () => {
      // Should show the username and the profile content (may have 0 habits)
      await expect(page.getByText(`@${uniqueUser}`)).toBeVisible({ timeout: 15_000 });
      test.info().annotations.push({ type: "step", description: "Public profile loaded" });
    });

    await test.step("verify CTA is displayed", async () => {
      await expect(page.getByText("Track your own habits")).toBeVisible();
      await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
      test.info().annotations.push({ type: "step", description: "CTA section visible" });
    });

    await test.step("verify footer is displayed", async () => {
      await expect(page.getByText("Powered by Winzy.ai")).toBeVisible();
      test.info().annotations.push({ type: "step", description: "Footer visible" });
    });
  });

  test("CTA navigates to auth flow", async ({ unauthenticatedPage: page }) => {
    await test.step("navigate to a nonexistent profile", async () => {
      await page.goto("/@nonexistentuser123");
      await expect(page.getByText("User not found")).toBeVisible({ timeout: 15_000 });
      test.info().annotations.push({ type: "step", description: "On not-found public flame page" });
    });

    await test.step("click the CTA button", async () => {
      await page.getByText("Create your own flame").click();
      test.info().annotations.push({ type: "step", description: "Clicked CTA" });
    });

    await test.step("verify auth screen is shown", async () => {
      // After CTA click, the URL should change to "/" and auth screen should appear
      await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({ type: "step", description: "Auth screen displayed after CTA" });
    });
  });

  test("no console errors on public flame page", async ({ unauthenticatedPage: page }) => {
    const benignPatterns = [
      /development build/i,
      /hot module replacement/i,
      /service worker/i,
      /favicon/i,
      /manifest/i,
    ];

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!benignPatterns.some((p) => p.test(text))) {
          errors.push(text);
        }
      }
    });

    await page.goto("/@someuser");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the page to settle (loading state resolves to not-found or profile)
    await expect(
      page.getByText("User not found").or(page.getByText(/consistency/)),
    ).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  });
});
