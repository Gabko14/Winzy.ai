import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";

/**
 * Browser back-button behavior (winzy.ai-y4s1).
 *
 * WRITE-ONLY for this round — do not run against port 5050 without a PM GO.
 * Covers the two acceptance scenarios from the bead:
 *   1) open overlay -> page.goBack() -> overlay closed, app stays alive
 *   2) switch to Friends -> page.goBack() -> Today
 */

async function registerAndReachToday(
  page: import("@playwright/test").Page,
  uniqueUser: string,
) {
  const email = `${uniqueUser}@winzy.test`;

  await page.goto("/");
  await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Create your account")).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(uniqueUser);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("What should we call you?")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel("Display name").fill("Back Tester");
  await page.getByRole("button", { name: "Continue" }).click();
  await dismissWelcomeIfPresent(page);

  await expect(
    page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("Browser back button", () => {
  test("overlay open then goBack closes overlay and keeps app alive", async ({
    unauthenticatedPage: page,
  }) => {
    const uniqueUser = `e2e_back_overlay_${Date.now()}`;
    await registerAndReachToday(page, uniqueUser);

    await page.getByTestId("tab-profile").click();
    await expect(page.getByTestId("profile-screen")).toBeVisible({
      timeout: 10_000,
    });

    const settingsBtn = page.getByText("Settings").or(page.getByTestId("settings-press"));
    await settingsBtn.first().click();
    await expect(page.getByTestId("settings-screen")).toBeVisible({
      timeout: 10_000,
    });

    await page.goBack();

    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("tab-bar")).toBeVisible();
  });

  test("Friends tab then goBack returns to Today", async ({
    unauthenticatedPage: page,
  }) => {
    const uniqueUser = `e2e_back_tab_${Date.now()}`;
    await registerAndReachToday(page, uniqueUser);

    await page.getByTestId("tab-friends").click();
    await expect(page.getByTestId("tab-friends")).toBeVisible();

    await page.goBack();

    await expect(page.getByTestId("tab-today")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId("today-empty").or(page.getByTestId("today-screen")),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });
});
