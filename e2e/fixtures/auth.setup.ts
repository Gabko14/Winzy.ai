import { test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";

const authDir = path.join(__dirname, "..", ".auth");
const authFile = path.join(authDir, "user.json");

/**
 * Auth setup project.
 *
 * Currently the app has no auth screens, so this is a placeholder that
 * creates an empty storageState file. Once auth screens land, replace
 * the body with real login steps:
 *
 *   await page.goto("/login");
 *   await page.getByLabel("Email").fill(TEST_USER.email);
 *   await page.getByLabel("Password").fill(TEST_USER.password);
 *   await page.getByRole("button", { name: "Sign in" }).click();
 *   await page.waitForURL("/");
 *   await page.context().storageState({ path: authFile });
 */
setup("authenticate", async ({ page }) => {
  // Ensure .auth directory exists
  fs.mkdirSync(authDir, { recursive: true });

  // Placeholder: save empty state so dependent projects don't fail
  await page.context().storageState({ path: authFile });
});
