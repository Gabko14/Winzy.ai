import type { CompletionsRangeResponse, FrequencyType } from "../api/habits";
import { queryKeys } from "../api/queryKeys";
import type { QueryClient } from "@tanstack/react-query";
import { dayEntryFor, findHabitInRange } from "./completionsRangeCache";
import { isHabitDueOnDate, localTodayISO, weekStripRange } from "./completionCycle";

type HabitDueInput = {
  id: string;
  frequency: FrequencyType;
  customDays?: number[] | null;
};

/**
 * Count of habits due on `today` that are not yet completed.
 * Uses the same isHabitDueOnDate rule as Today (never fork that logic).
 */
export function countDueIncompleteHabits(
  habits: HabitDueInput[],
  range: CompletionsRangeResponse | undefined,
  today: string,
): number {
  let count = 0;
  for (const habit of habits) {
    if (!isHabitDueOnDate(habit.frequency, habit.customDays, today)) continue;
    const entry = dayEntryFor(findHabitInRange(range, habit.id), today);
    if (!entry?.completed) count += 1;
  }
  return count;
}

/** Feature-detected Badging API — never throws (unsupported browsers / iOS without permission). */
export async function applyAppBadge(count: number): Promise<void> {
  try {
    if (typeof navigator === "undefined") return;
    const n = Math.max(0, Math.floor(count));
    if (n <= 0) {
      if (typeof navigator.clearAppBadge === "function") {
        await navigator.clearAppBadge();
      }
      return;
    }
    if (typeof navigator.setAppBadge === "function") {
      await navigator.setAppBadge(n);
    }
  } catch {
    // Degrade silently (Firefox desktop, denied iOS permission, etc.).
  }
}

/** Read habits + week range from the query cache and update the app-icon badge. */
export function syncAppBadgeFromCache(
  queryClient: QueryClient,
  today: string = localTodayISO(),
): Promise<void> {
  const habits = queryClient.getQueryData<HabitDueInput[]>(queryKeys.habits.list());
  if (!habits) return Promise.resolve();

  const { from, to } = weekStripRange(today);
  const range = queryClient.getQueryData<CompletionsRangeResponse>(
    queryKeys.completions.range(from, to),
  );
  return applyAppBadge(countDueIncompleteHabits(habits, range, today));
}
