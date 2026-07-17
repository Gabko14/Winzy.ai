import { useCallback, useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchHabitStats,
  completeHabit,
  deleteCompletion,
  type Habit,
  type HabitStats,
  type FlameLevel,
  type CompletionKind,
} from "../api/habits";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";
import { habitsListQueryOptions } from "./useHabits";

export type TodayHabit = {
  habit: Habit;
  completedToday: boolean;
  completedTodayKind: CompletionKind | null;
  flameLevel: FlameLevel;
  consistency: number;
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

function errorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
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

function toTodayHabit(habit: Habit, stats: HabitStats | null | undefined): TodayHabit {
  return {
    habit,
    completedToday: stats?.completedToday ?? false,
    completedTodayKind: stats?.completedTodayKind ?? null,
    flameLevel: (stats?.flameLevel ?? "none") as FlameLevel,
    consistency: stats?.consistency ?? 0,
  };
}

type ToggleVariables = {
  habitId: string;
  wasCompleted: boolean;
  previousKind: CompletionKind | null;
  targetKind: CompletionKind;
  timezone: string;
  today: string;
};

export function useTodayHabits() {
  const queryClient = useQueryClient();
  const timezone = getUserTimezone();

  const habitsQuery = useQuery(habitsListQueryOptions());

  const dueHabits = useMemo(
    () => (habitsQuery.data ?? []).filter(isDueToday),
    [habitsQuery.data],
  );

  const statsQueries = useQueries({
    queries: dueHabits.map((habit) => ({
      queryKey: queryKeys.habits.stats(habit.id, timezone),
      queryFn: () => fetchHabitStats(habit.id, timezone),
      enabled: habitsQuery.isSuccess,
    })),
  });

  const items = useMemo(
    () =>
      dueHabits.map((habit, i) => {
        const statsQuery = statsQueries[i];
        const stats = statsQuery?.isSuccess ? statsQuery.data : null;
        return toTodayHabit(habit, stats);
      }),
    [dueHabits, statsQueries],
  );

  const statsLoading =
    habitsQuery.isSuccess &&
    dueHabits.length > 0 &&
    (statsQueries.length < dueHabits.length || statsQueries.some((q) => !q.isFetched));
  const loading = habitsQuery.isPending || statsLoading;

  const toggleMutation = useMutation({
    mutationFn: async (vars: ToggleVariables) => {
      if (vars.wasCompleted) {
        await deleteCompletion(vars.habitId, vars.today);
      } else {
        await completeHabit(vars.habitId, {
          timezone: vars.timezone,
          date: vars.today,
          completionKind: vars.targetKind,
        });
      }
    },
    onMutate: async (vars, { client }) => {
      const statsKey = queryKeys.habits.stats(vars.habitId, vars.timezone);
      await client.cancelQueries({ queryKey: statsKey });
      const previousStats = client.getQueryData<HabitStats>(statsKey);

      client.setQueryData<HabitStats>(statsKey, (old) => {
        const base = old ?? previousStats;
        if (!base) {
          return {
            habitId: vars.habitId,
            consistency: 0,
            flameLevel: "none",
            totalCompletions: 0,
            completionsInWindow: 0,
            completedToday: !vars.wasCompleted,
            completedTodayKind: vars.wasCompleted ? null : vars.targetKind,
            windowDays: 60,
            windowStart: vars.today,
            today: vars.today,
            completedDates: [],
          };
        }
        return {
          ...base,
          completedToday: !vars.wasCompleted,
          completedTodayKind: vars.wasCompleted ? null : vars.targetKind,
        };
      });

      return { previousStats, statsKey };
    },
    onError: (err, vars, onMutateResult, { client }) => {
      if (!onMutateResult) return;
      const code = errorCode(err);

      if (!vars.wasCompleted && code === "conflict") {
        const current = client.getQueryData<HabitStats>(onMutateResult.statsKey);
        if (current) {
          client.setQueryData<HabitStats>(onMutateResult.statsKey, {
            ...current,
            completedToday: true,
          });
        }
        return;
      }

      if (vars.wasCompleted && code === "not_found") {
        const current = client.getQueryData<HabitStats>(onMutateResult.statsKey);
        if (current) {
          client.setQueryData<HabitStats>(onMutateResult.statsKey, {
            ...current,
            completedToday: false,
            completedTodayKind: null,
          });
        }
        return;
      }

      if (onMutateResult.previousStats !== undefined) {
        client.setQueryData(onMutateResult.statsKey, onMutateResult.previousStats);
      }
    },
    onSettled: (_data, error, vars, _onMutateResult, { client }) => {
      const code = errorCode(error);
      if (code === "conflict" || code === "not_found") {
        return;
      }
      void client.invalidateQueries({
        queryKey: queryKeys.habits.stats(vars.habitId, vars.timezone),
      });
    },
  });

  const completing = useMemo(() => {
    const set = new Set<string>();
    if (toggleMutation.isPending && toggleMutation.variables) {
      set.add(toggleMutation.variables.habitId);
    }
    return set;
  }, [toggleMutation.isPending, toggleMutation.variables]);

  const toggleCompletion = useCallback(
    async (habitId: string, kind?: CompletionKind) => {
      const currentItem = items.find((i) => i.habit.id === habitId);
      if (!currentItem) return;
      if (completing.has(habitId)) return;

      try {
        await toggleMutation.mutateAsync({
          habitId,
          wasCompleted: currentItem.completedToday,
          previousKind: currentItem.completedTodayKind,
          targetKind: kind ?? "full",
          timezone,
          today: getTodayDate(),
        });
      } catch {
        // Errors are handled in onError (rollback / conflict / not_found).
      }
    },
    [items, completing, toggleMutation, timezone],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() });
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === "habit" &&
          key[2] === "stats" &&
          key[3] === timezone
        );
      },
    });
  }, [queryClient, timezone]);

  const completedCount = items.filter((i) => i.completedToday).length;
  const totalCount = items.length;

  return {
    items,
    loading,
    error: (habitsQuery.error as ApiError | null) ?? null,
    completing,
    completedCount,
    totalCount,
    refresh,
    toggleCompletion,
  };
}
