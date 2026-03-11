import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";

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
