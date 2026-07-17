import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchHabitStats,
  fetchCompletionsRange,
  completeHabit,
  deleteCompletion,
  updateCompletion,
  type Habit,
  type HabitStats,
  type FlameLevel,
  type CompletionKind,
  type CompletionsRangeResponse,
  type CompletionDayEntry,
} from "../api/habits";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";
import { habitsListQueryOptions } from "./useHabits";
import {
  isHabitDueOnDate,
  isDateInCompletionWindow,
  localTodayISO,
  nextCompletionCycle,
  weekStripRange,
  weekdayLongName,
} from "../utils/completionCycle";
import { dayEntryFor, findHabitInRange, patchRangeDay } from "../utils/completionsRangeCache";
import { syncAppBadgeFromCache } from "../utils/appBadge";

export type TodayHabit = {
  habit: Habit;
  completedToday: boolean;
  completedTodayKind: CompletionKind | null;
  flameLevel: FlameLevel;
  consistency: number;
  /** Days in [today-6, today] from the shared range cache (same source as completedToday). */
  weekDays: CompletionDayEntry[];
};

export type UndoChip = {
  habitId: string;
  date: string;
  previousKind: CompletionKind | null;
  message: string;
};

function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function errorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function isDueToday(habit: Habit, today: string): boolean {
  return isHabitDueOnDate(habit.frequency, habit.customDays, today);
}

type DayToggleVariables = {
  habitId: string;
  date: string;
  today: string;
  timezone: string;
  hasMinimum: boolean;
  previousKind: CompletionKind | null;
  cycle: ReturnType<typeof nextCompletionCycle>;
  /** Past-day taps get an undo chip; today does not. */
  offerUndo: boolean;
};

export function useTodayHabits() {
  const queryClient = useQueryClient();
  const timezone = getUserTimezone();
  const today = localTodayISO();
  const { from, to } = weekStripRange(today);
  const rangeKey = queryKeys.completions.range(from, to);

  const [undo, setUndo] = useState<UndoChip | null>(null);

  const habitsQuery = useQuery(habitsListQueryOptions());

  const dueHabits = useMemo(
    () => (habitsQuery.data ?? []).filter((h) => isDueToday(h, today)),
    [habitsQuery.data, today],
  );

  const notTodayHabits = useMemo(
    () => (habitsQuery.data ?? []).filter((h) => !isDueToday(h, today)),
    [habitsQuery.data, today],
  );

  const rangeQuery = useQuery({
    queryKey: rangeKey,
    queryFn: () => fetchCompletionsRange(from, to),
    enabled: habitsQuery.isSuccess,
  });

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
        const rangeHabit = findHabitInRange(rangeQuery.data, habit.id);
        const todayEntry = dayEntryFor(rangeHabit, today);
        const completedToday = todayEntry?.completed ?? false;
        const completedTodayKind = (todayEntry?.completionKind ?? null) as CompletionKind | null;
        return {
          habit,
          completedToday,
          completedTodayKind,
          flameLevel: (stats?.flameLevel ?? "none") as FlameLevel,
          consistency: stats?.consistency ?? 0,
          weekDays: rangeHabit?.days ?? [],
        } satisfies TodayHabit;
      }),
    [dueHabits, statsQueries, rangeQuery.data, today],
  );

  const statsLoading =
    habitsQuery.isSuccess &&
    dueHabits.length > 0 &&
    (statsQueries.length < dueHabits.length || statsQueries.some((q) => !q.isFetched));
  const rangeLoading = habitsQuery.isSuccess && rangeQuery.isPending;
  const loading = habitsQuery.isPending || statsLoading || rangeLoading;

  const dayMutation = useMutation({
    mutationFn: async (vars: DayToggleVariables) => {
      const { cycle, habitId, date, timezone: tz } = vars;
      if (cycle.action === "uncomplete") {
        await deleteCompletion(habitId, date);
      } else if (cycle.action === "updateKind") {
        await updateCompletion(habitId, date, cycle.kind);
      } else {
        await completeHabit(habitId, {
          timezone: tz,
          date,
          completionKind: cycle.kind,
        });
      }
    },
    onMutate: async (vars, { client }) => {
      await client.cancelQueries({ queryKey: rangeKey });
      const previousRange = client.getQueryData<CompletionsRangeResponse>(rangeKey);
      const statsKey = queryKeys.habits.stats(vars.habitId, vars.timezone);
      await client.cancelQueries({ queryKey: statsKey });
      const previousStats = client.getQueryData<HabitStats>(statsKey);

      const nextCompleted = vars.cycle.action !== "uncomplete";
      const nextKind: CompletionKind | null =
        vars.cycle.action === "uncomplete" ? null : vars.cycle.kind;

      if (previousRange) {
        client.setQueryData(
          rangeKey,
          patchRangeDay(previousRange, vars.habitId, vars.date, nextCompleted, nextKind),
        );
      }

      if (vars.date === vars.today) {
        client.setQueryData<HabitStats>(statsKey, (old) => {
          const base = old ?? previousStats;
          if (!base) {
            return {
              habitId: vars.habitId,
              consistency: 0,
              flameLevel: "none",
              totalCompletions: 0,
              completionsInWindow: 0,
              completedToday: nextCompleted,
              completedTodayKind: nextKind,
              windowDays: 60,
              windowStart: vars.today,
              today: vars.today,
              completedDates: [],
            };
          }
          return {
            ...base,
            completedToday: nextCompleted,
            completedTodayKind: nextKind,
          };
        });
      }

      return { previousRange, previousStats, statsKey };
    },
    onError: (err, vars, ctx, { client }) => {
      if (!ctx) return;
      const code = errorCode(err);

      if (vars.cycle.action === "complete" && code === "conflict") {
        if (ctx.previousRange) {
          client.setQueryData(
            rangeKey,
            patchRangeDay(ctx.previousRange, vars.habitId, vars.date, true, "full"),
          );
        }
        return;
      }
      if (vars.cycle.action === "uncomplete" && code === "not_found") {
        if (ctx.previousRange) {
          client.setQueryData(
            rangeKey,
            patchRangeDay(ctx.previousRange, vars.habitId, vars.date, false, null),
          );
        }
        return;
      }

      if (ctx.previousRange !== undefined) {
        client.setQueryData(rangeKey, ctx.previousRange);
      }
      if (ctx.previousStats !== undefined) {
        client.setQueryData(ctx.statsKey, ctx.previousStats);
      }
    },
    onSuccess: (_data, vars) => {
      if (vars.offerUndo) {
        setUndo({
          habitId: vars.habitId,
          date: vars.date,
          previousKind: vars.previousKind,
          message: `Marked ${weekdayLongName(vars.date)}`,
        });
      }
    },
    onSettled: (_data, error, vars, _ctx, { client }) => {
      const code = errorCode(error);
      if (code === "conflict" || code === "not_found") return;
      void client.invalidateQueries({
        queryKey: queryKeys.habits.stats(vars.habitId, vars.timezone),
      });
      void client.invalidateQueries({ queryKey: rangeKey });
      void syncAppBadgeFromCache(client, today);
    },
  });

  const completing = useMemo(() => {
    const set = new Set<string>();
    if (dayMutation.isPending && dayMutation.variables) {
      set.add(`${dayMutation.variables.habitId}:${dayMutation.variables.date}`);
    }
    return set;
  }, [dayMutation.isPending, dayMutation.variables]);

  const runCycle = useCallback(
    async (habitId: string, date: string, offerUndo: boolean) => {
      const item = items.find((i) => i.habit.id === habitId);
      if (!item) return;
      if (!isDateInCompletionWindow(date, today)) return;
      if (date > today) return;
      if (completing.has(`${habitId}:${date}`)) return;

      const hasMinimum = !!item.habit.minimumDescription;
      const rangeHabit = findHabitInRange(rangeQuery.data, habitId);
      const entry = dayEntryFor(rangeHabit, date);
      const previousKind = (entry?.completionKind ?? null) as CompletionKind | null;
      const cycle = nextCompletionCycle(previousKind, hasMinimum);

      try {
        await dayMutation.mutateAsync({
          habitId,
          date,
          today,
          timezone,
          hasMinimum,
          previousKind,
          cycle,
          offerUndo,
        });
      } catch {
        // Handled in onError.
      }
    },
    [items, today, completing, rangeQuery.data, dayMutation, timezone],
  );

  const toggleCompletion = useCallback(
    async (habitId: string, kind?: CompletionKind) => {
      const item = items.find((i) => i.habit.id === habitId);
      if (!item) return;
      if (completing.has(`${habitId}:${today}`)) return;

      const hasMinimum = !!item.habit.minimumDescription;
      const previousKind = item.completedTodayKind;
      // Primary today control is binary/dual-button, not HabitDetail's full cycle.
      const cycle: ReturnType<typeof nextCompletionCycle> = item.completedToday
        ? { action: "uncomplete" }
        : { action: "complete", kind: kind ?? "full" };

      try {
        await dayMutation.mutateAsync({
          habitId,
          date: today,
          today,
          timezone,
          hasMinimum,
          previousKind,
          cycle,
          offerUndo: false,
        });
      } catch {
        // Handled in onError.
      }
    },
    [items, completing, today, dayMutation, timezone],
  );

  const toggleDay = useCallback(
    async (habitId: string, date: string) => {
      await runCycle(habitId, date, date < today);
    },
    [runCycle, today],
  );

  const undoLast = useCallback(async () => {
    if (!undo) return;
    const { habitId, date, previousKind } = undo;
    setUndo(null);

    const hasMinimum = !!items.find((i) => i.habit.id === habitId)?.habit.minimumDescription;
    const rangeHabit = findHabitInRange(rangeQuery.data, habitId);
    const entry = dayEntryFor(rangeHabit, date);
    const currentKind = (entry?.completionKind ?? null) as CompletionKind | null;

    // Revert to previousKind from current state.
    let cycle: ReturnType<typeof nextCompletionCycle>;
    if (previousKind == null) {
      cycle = { action: "uncomplete" };
    } else if (currentKind == null) {
      cycle = { action: "complete", kind: previousKind };
    } else if (currentKind !== previousKind) {
      cycle = { action: "updateKind", kind: previousKind };
    } else {
      return;
    }

    try {
      await dayMutation.mutateAsync({
        habitId,
        date,
        today,
        timezone,
        hasMinimum,
        previousKind: currentKind,
        cycle,
        offerUndo: false,
      });
    } catch {
      // Handled in onError.
    }
  }, [undo, items, rangeQuery.data, dayMutation, today, timezone]);

  const dismissUndo = useCallback(() => setUndo(null), []);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() });
    await queryClient.invalidateQueries({ queryKey: rangeKey });
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
  }, [queryClient, rangeKey, timezone]);

  const completedCount = items.filter((i) => i.completedToday).length;
  const totalCount = items.length;

  return {
    items,
    notTodayHabits,
    allHabits: habitsQuery.data ?? [],
    hasAnyHabits: (habitsQuery.data ?? []).length > 0,
    loading,
    error: (habitsQuery.error as ApiError | null) ?? (rangeQuery.error as ApiError | null) ?? null,
    completing,
    completedCount,
    totalCount,
    today,
    undo,
    refresh,
    toggleCompletion,
    toggleDay,
    undoLast,
    dismissUndo,
  };
}
