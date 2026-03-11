import { test, expect } from "../fixtures/base";

test.describe("Smoke", () => {
  test("app boots and renders the shell", async ({ page }) => {
    await page.goto("/");

    // The Expo default app renders a View with visible text.
    // This verifies the web build starts and React mounts successfully.
    await expect(page.locator("body")).toBeVisible();

    // Verify no crash — the page should not show an error overlay.
    // Expo web shows errors in a div with data-testid="__expo-error-overlay".
    await expect(page.locator('[data-testid="__expo-error-overlay"]')).not.toBeVisible();
  });

  test("page title is set", async ({ page }) => {
    await page.goto("/");

    // Expo web sets the title from app.json "name" field
    await expect(page).toHaveTitle(/.+/);
  });

  test("no console errors on initial load", async ({ page }) => {
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

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    expect(errors).toEqual([]);
  });
});
