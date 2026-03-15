import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * Dismisses the post-auth welcome screen if present.
 * After registration or first login, RootNavigator shows WelcomeScreen
 * when the onboarding welcome flag is not set. Call this after profile
 * completion / login, before asserting on the Today screen.
 *
 * The WelcomeScreen button has title "Let's go" and accessibilityLabel
 * "Continue to the app". On React Native Web, Pressable renders as a
 * <div role="button"> which Playwright may not reliably match with
 * getByRole("button"). We match by visible text instead, handling both
 * straight ("Let's go") and curly ("\u2019") apostrophes.
 */
export async function dismissWelcomeIfPresent(page: Page) {
  const letsGo = page.getByText("Let\u2019s go").or(page.getByText("Let's go")).first();
  try {
    await letsGo.waitFor({ state: "visible", timeout: 5_000 });
    await letsGo.click();
  } catch {
    // Welcome screen not shown
  }
}

/**
 * Test data for a standard test user.
 * In the future, this will be populated from seeded DB fixtures.
 * For now, tests that need auth use the setup project's storageState.
 */
export interface TestUser {
  email: string;
  password: string;
  username: string;
}

export const TEST_USER: TestUser = {
  email: "e2e-user@winzy.test",
  password: "TestPassword123!",
  username: "e2e-user",
};

type Fixtures = {
  /** A page that is NOT authenticated (no storageState). */
  unauthenticatedPage: Page;
};

export const test = base.extend<Fixtures>({
  unauthenticatedPage: async ({ browser }, use) => {
    const context: BrowserContext = await browser.newContext({
      storageState: undefined,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
