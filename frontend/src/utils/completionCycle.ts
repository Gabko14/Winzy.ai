import type { CompletionKind, FrequencyType } from "../api/habits";

export const COMPLETION_WINDOW_DAYS = 60;

export type CycleResult =
  | { action: "complete"; kind: CompletionKind }
  | { action: "updateKind"; kind: CompletionKind }
  | { action: "uncomplete" };

/**
 * HabitDetail calendar + week-strip cycle:
 * none → full → minimum (only if habit has minimumDescription) → none.
 */
export function nextCompletionCycle(
  currentKind: CompletionKind | null | undefined,
  hasMinimum: boolean,
): CycleResult {
  const wasCompleted = currentKind != null;
  if (!wasCompleted) {
    return { action: "complete", kind: "full" };
  }
  if (hasMinimum && currentKind === "full") {
    return { action: "updateKind", kind: "minimum" };
  }
  return { action: "uncomplete" };
}

/** Inclusive civil-date window [today-(windowDays-1), today]. */
export function isDateInCompletionWindow(
  date: string,
  today: string,
  windowDays: number = COMPLETION_WINDOW_DAYS,
): boolean {
  if (date > today) return false;
  const start = addDaysISO(today, -(windowDays - 1));
  return date >= start;
}

export function formatISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local-calendar today (device timezone). */
export function localTodayISO(): string {
  return formatISODate(new Date());
}

export function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return formatISODate(dt);
}

export function weekStripRange(today: string = localTodayISO()): { from: string; to: string } {
  return { from: addDaysISO(today, -6), to: today };
}

/** Weekday initial for a YYYY-MM-DD local date (Sun=S … Sat=S). */
export function weekdayInitial(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return ["S", "M", "T", "W", "T", "F", "S"][dow] ?? "?";
}

export function weekdayLongName(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long" });
}

/**
 * Whether a habit is due on a civil date (local weekday).
 * daily: always; weekly/custom: customDays includes weekday (0=Sun..6=Sat).
 */
export function isHabitDueOnDate(
  frequency: FrequencyType,
  customDays: number[] | null | undefined,
  dateStr: string,
): boolean {
  if (frequency === "daily") return true;
  if (!customDays || customDays.length === 0) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return customDays.includes(dow);
}
