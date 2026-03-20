import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchHabits,
  fetchHabitStats,
  completeHabit,
  deleteCompletion,
  COMPLETION_KIND,
  type Habit,
  type FlameLevel,
  type CompletionKind,
} from "../api/habits";
import type { ApiError } from "../api/types";
import { isApiError } from "../api/types";

export type TodayHabit = {
  habit: Habit;
  completedToday: boolean;
  completedTodayKind: CompletionKind | null;
  flameLevel: FlameLevel;
  consistency: number;
};

type TodayState = {
  items: TodayHabit[];
  loading: boolean;
  error: ApiError | null;
};

function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Check if a habit is due today based on its frequency schedule.
 * - daily: always due
 * - weekly: due if today's day-of-week (0=Sun..6=Sat) is in customDays
 * - custom: due if today's day-of-week is in customDays
 */
function isDueToday(habit: Habit): boolean {
  if (habit.frequency === "daily") return true;
  if (!habit.customDays || habit.customDays.length === 0) return false;
  const todayDow = new Date().getDay();
  return habit.customDays.includes(todayDow);
}

export function useTodayHabits() {
  const [state, setState] = useState<TodayState>({
    items: [],
    loading: true,
    error: null,
  });
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const tz = getUserTimezone();

    try {
      const allHabits = await fetchHabits();
      if (!mountedRef.current) return;

      // Filter to only habits that are due today based on frequency schedule
      const habits = allHabits.filter(isDueToday);

      // Fetch stats for all habits in parallel (for flame levels)
      const statsResults = await Promise.allSettled(
        habits.map((h) => fetchHabitStats(h.id, tz)),
      );
      if (!mountedRef.current) return;

      const items: TodayHabit[] = habits.map((habit, i) => {
        const statsResult = statsResults[i];
        const stats = statsResult.status === "fulfilled" ? statsResult.value : null;

        return {
          habit,
          completedToday: stats?.completedToday ?? false,
          completedTodayKind: stats?.completedTodayKind ?? null,
          flameLevel: (stats?.flameLevel ?? "none") as FlameLevel,
          consistency: stats?.consistency ?? 0,
        };
      });

      setState({ items, loading: false, error: null });
    } catch (err) {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleCompletion = useCallback(
    async (habitId: string, kind?: CompletionKind) => {
      const tz = getUserTimezone();
      const today = getTodayDate();
      const currentItem = state.items.find((i) => i.habit.id === habitId);
      if (!currentItem) return;

      const wasCompleted = currentItem.completedToday;
      const targetKind = kind ?? "full";
      const backendKind = targetKind === "minimum" ? COMPLETION_KIND.minimum : COMPLETION_KIND.full;

      // Prevent double-taps while a completion is in flight
      if (completing.has(habitId)) return;
      setCompleting((s) => new Set(s).add(habitId));

      // Optimistic update
      setState((s) => ({
        ...s,
        items: s.items.map((i) =>
          i.habit.id === habitId
            ? { ...i, completedToday: !wasCompleted, completedTodayKind: wasCompleted ? null : targetKind }
            : i,
        ),
      }));

      try {
        if (wasCompleted) {
          await deleteCompletion(habitId, today);
        } else {
          await completeHabit(habitId, { timezone: tz, date: today, completionKind: backendKind });
        }

        if (!mountedRef.current) return;

        // Refresh stats for updated flame level
        try {
          const updatedStats = await fetchHabitStats(habitId, tz);
          if (!mountedRef.current) return;
          setState((s) => ({
            ...s,
            items: s.items.map((i) =>
              i.habit.id === habitId
                ? {
                    ...i,
                    completedToday: updatedStats.completedToday,
                    completedTodayKind: updatedStats.completedTodayKind,
                    flameLevel: updatedStats.flameLevel as FlameLevel,
                    consistency: updatedStats.consistency,
                  }
                : i,
            ),
          }));
        } catch {
          // Stats refresh failure is non-critical
        }
      } catch (err) {
        if (!mountedRef.current) return;

        // 409 on complete = already completed today. Update state to reflect reality.
        if (!wasCompleted && isApiError(err) && err.code === "conflict") {
          setState((s) => ({
            ...s,
            items: s.items.map((i) =>
              i.habit.id === habitId ? { ...i, completedToday: true } : i,
            ),
          }));
          return;
        }
        // 404 on uncomplete = already uncompleted. Update state to reflect reality.
        if (wasCompleted && isApiError(err) && err.code === "not_found") {
          setState((s) => ({
            ...s,
            items: s.items.map((i) =>
              i.habit.id === habitId ? { ...i, completedToday: false, completedTodayKind: null } : i,
            ),
          }));
          return;
        }

        // Revert optimistic update for other errors
        setState((s) => ({
          ...s,
          items: s.items.map((i) =>
            i.habit.id === habitId
              ? { ...i, completedToday: wasCompleted, completedTodayKind: wasCompleted ? currentItem.completedTodayKind : null }
              : i,
          ),
        }));
      } finally {
        if (mountedRef.current) {
          setCompleting((s) => {
            const next = new Set(s);
            next.delete(habitId);
            return next;
          });
        }
      }
    },
    [state.items, completing],
  );

  const completedCount = state.items.filter((i) => i.completedToday).length;
  const totalCount = state.items.length;

  return {
    items: state.items,
    loading: state.loading,
    error: state.error,
    completing,
    completedCount,
    totalCount,
    refresh: load,
    toggleCompletion,
  };
}
