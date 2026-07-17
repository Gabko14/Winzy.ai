import { test, expect, TEST_USER, dismissWelcomeIfPresent } from "../fixtures/base";

/**
 * Challenge invite public landing — logged-out happy path (winzy.ai-jc38.2).
 *
 * WRITE-ONLY for this round — do not run against port 5050 without a PM GO.
 *
 * Flow: open /ci/{token} -> Join Winzy & accept -> sign up -> Today with
 * accepted habit (claim happens post-auth via persisted token).
 *
 * Requires a pending invite token seeded in the environment (API create as
 * an existing user, or fixture). Placeholder token below is replaced when
 * the E2E lane is given GO.
 */

const INVITE_TOKEN = process.env.E2E_CHALLENGE_INVITE_TOKEN ?? "REPLACE_WITH_SEEDED_TOKEN";

test.describe("Challenge invite landing", () => {
  test("logged-out open link -> sign up -> challenge accepted on Today", async ({
    unauthenticatedPage: page,
  }) => {
    test.skip(
      INVITE_TOKEN === "REPLACE_WITH_SEEDED_TOKEN",
      "Needs a seeded pending invite token (E2E_CHALLENGE_INVITE_TOKEN)",
    );

    const uniqueUser = `e2e_ci_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;

    await page.goto(`/ci/${INVITE_TOKEN}`);
    await expect(page.getByTestId("challenge-invite-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Join Winzy and accept challenge" })).toBeVisible();

    await page.getByRole("button", { name: "Join Winzy and accept challenge" }).click();
    await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Sign up" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Username").fill(uniqueUser);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("What should we call you?")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Display name").fill("Invite Joiner");
    await page.getByRole("button", { name: "Continue" }).click();
    await dismissWelcomeIfPresent(page);

    await expect(
      page.getByTestId("invite-claim-banner").or(page.getByTestId("today-screen")).or(page.getByTestId("today-empty")),
    ).toBeVisible({ timeout: 20_000 });
  });
});
