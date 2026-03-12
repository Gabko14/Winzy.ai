import { test, expect, TEST_USER } from "../fixtures/base";

/**
 * HabitDetailScreen E2E tests.
 *
 * Tests the calendar view, month navigation, completion toggling,
 * and consistency stats on the habit detail screen.
 */
test.describe("Habit detail screen", () => {
  test("view habit detail, navigate calendar, and toggle completion", async ({
    unauthenticatedPage: page,
  }) => {
    const uniqueUser = `e2e_detail_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;
    const displayName = "Detail Tester";
    const habitName = "Read a book";

    await test.step("register and complete profile", async () => {
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
      await page.getByLabel("Display name").fill(displayName);
      await page.getByRole("button", { name: "Continue" }).click();
      test.info().annotations.push({
        type: "step",
        description: `Registered and completed profile: ${uniqueUser}`,
      });
    });

    await test.step("create a habit", async () => {
      await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
      await page.getByText("Create your first habit").click();

      await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
      await page.getByLabel("Habit name").fill(habitName);
      await page.getByRole("button", { name: "Create habit" }).click();

      // Wait for habit to appear in the list (redirects back to Today or HabitList)
      await expect(page.getByText(habitName)).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: `Created habit: ${habitName}`,
      });
    });

    await test.step("navigate to habit detail by tapping the habit row", async () => {
      // The Today screen shows habit rows; clicking navigates to HabitDetailScreen
      await page.getByText(habitName).click();

      await expect(page.getByTestId("habit-detail-screen")).toBeVisible({
        timeout: 10_000,
      });
      test.info().annotations.push({
        type: "step",
        description: "Navigated to HabitDetailScreen",
      });
    });

    await test.step("verify habit detail header renders", async () => {
      await expect(page.getByTestId("habit-name")).toHaveText(habitName);
      await expect(page.getByTestId("habit-flame")).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Habit name and flame visible on detail screen",
      });
    });

    await test.step("verify consistency stats card", async () => {
      await expect(page.getByTestId("consistency-value")).toBeVisible();
      await expect(page.getByTestId("completions-in-window")).toBeVisible();
      await expect(page.getByTestId("total-completions")).toBeVisible();
      await expect(page.getByTestId("encouraging-message")).toBeVisible();

      // New habit with no completions should show 0%
      await expect(page.getByTestId("consistency-value")).toHaveText("0%");
      await expect(page.getByTestId("completions-in-window")).toHaveText("0");
      await expect(page.getByTestId("total-completions")).toHaveText("0");
      test.info().annotations.push({
        type: "step",
        description: "Consistency stats show zero for fresh habit",
      });
    });

    await test.step("verify calendar renders with current month", async () => {
      await expect(page.getByTestId("completion-calendar")).toBeVisible();

      // Calendar should show current month and year
      const now = new Date();
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const expectedLabel = `${months[now.getMonth()]} ${now.getFullYear()}`;
      await expect(page.getByText(expectedLabel)).toBeVisible();

      // Day header labels should be visible
      for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
        await expect(page.getByText(day, { exact: true })).toBeVisible();
      }
      test.info().annotations.push({
        type: "step",
        description: `Calendar shows ${expectedLabel} with day headers`,
      });
    });

    await test.step("navigate to previous month and back", async () => {
      const now = new Date();
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];

      // Go to previous month
      await page.getByTestId("calendar-prev").click();

      const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const prevLabel = `${months[prevMonth]} ${prevYear}`;
      await expect(page.getByText(prevLabel)).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: `Navigated to previous month: ${prevLabel}`,
      });

      // Go back to current month
      await page.getByTestId("calendar-next").click();

      const currentLabel = `${months[now.getMonth()]} ${now.getFullYear()}`;
      await expect(page.getByText(currentLabel)).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: `Navigated back to current month: ${currentLabel}`,
      });
    });

    await test.step("next month button is disabled on current month", async () => {
      // When viewing the current month, tapping "next" should not change the view
      const now = new Date();
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const currentLabel = `${months[now.getMonth()]} ${now.getFullYear()}`;

      await page.getByTestId("calendar-next").click();
      // Should still show the current month (can't go into the future)
      await expect(page.getByText(currentLabel)).toBeVisible();
      test.info().annotations.push({
        type: "step",
        description: "Next month button does not advance past current month",
      });
    });

    await test.step("toggle completion on today's date", async () => {
      // Build today's date string in YYYY-MM-DD format
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const todayStr = `${y}-${m}-${d}`;

      const todayCell = page.getByTestId(`calendar-day-${todayStr}`);
      await expect(todayCell).toBeVisible();

      // Click today's cell to mark as completed
      await todayCell.click();

      // After completion, stats should update (optimistic update)
      // Wait for the stats to reflect the completion
      await expect(page.getByTestId("completions-in-window")).toHaveText("1", {
        timeout: 5_000,
      });
      await expect(page.getByTestId("total-completions")).toHaveText("1", {
        timeout: 5_000,
      });
      test.info().annotations.push({
        type: "step",
        description: `Toggled completion on ${todayStr}, stats updated to 1`,
      });
    });

    await test.step("toggle completion off on today's date", async () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const todayStr = `${y}-${m}-${d}`;

      const todayCell = page.getByTestId(`calendar-day-${todayStr}`);
      await todayCell.click();

      // Stats should go back to 0
      await expect(page.getByTestId("completions-in-window")).toHaveText("0", {
        timeout: 5_000,
      });
      await expect(page.getByTestId("total-completions")).toHaveText("0", {
        timeout: 5_000,
      });
      test.info().annotations.push({
        type: "step",
        description: `Un-toggled completion on ${todayStr}, stats back to 0`,
      });
    });

    await test.step("navigate back to Today screen", async () => {
      await page.getByTestId("back-button").click();

      // Should return to Today screen with the habit visible
      await expect(
        page.getByTestId("today-screen").or(page.getByTestId("today-empty")),
      ).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: "Navigated back to Today screen",
      });
    });
  });

  test("calendar shows past dates as disabled outside 60-day window", async ({
    unauthenticatedPage: page,
  }) => {
    const uniqueUser = `e2e_cal_${Date.now()}`;
    const email = `${uniqueUser}@winzy.test`;
    const password = TEST_USER.password;
    const displayName = "Calendar Tester";
    const habitName = "Meditate";

    await test.step("register, complete profile, create habit", async () => {
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
      await page.getByLabel("Display name").fill(displayName);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page.getByTestId("today-empty")).toBeVisible({ timeout: 10_000 });
      await page.getByText("Create your first habit").click();

      await expect(page.getByLabel("Habit name")).toBeVisible({ timeout: 5_000 });
      await page.getByLabel("Habit name").fill(habitName);
      await page.getByRole("button", { name: "Create habit" }).click();
      await expect(page.getByText(habitName)).toBeVisible({ timeout: 10_000 });
      test.info().annotations.push({
        type: "step",
        description: `Setup complete: user ${uniqueUser}, habit ${habitName}`,
      });
    });

    await test.step("navigate to habit detail", async () => {
      await page.getByText(habitName).click();
      await expect(page.getByTestId("habit-detail-screen")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("navigate 3 months back and verify dates are disabled", async () => {
      // Go back 3 months — all dates should be outside the 60-day window
      await page.getByTestId("calendar-prev").click();
      await page.getByTestId("calendar-prev").click();
      await page.getByTestId("calendar-prev").click();

      // Pick the 15th of that month as a sample date
      const now = new Date();
      let targetMonth = now.getMonth() - 3;
      let targetYear = now.getFullYear();
      if (targetMonth < 0) {
        targetMonth += 12;
        targetYear -= 1;
      }
      const m = String(targetMonth + 1).padStart(2, "0");
      const dateStr = `${targetYear}-${m}-15`;

      const cell = page.getByTestId(`calendar-day-${dateStr}`);
      // The cell should exist but be disabled (outside 60-day window)
      await expect(cell).toBeVisible();
      await expect(cell).toBeDisabled();
      test.info().annotations.push({
        type: "step",
        description: `Date ${dateStr} is disabled (outside 60-day window)`,
      });
    });
  });
});
