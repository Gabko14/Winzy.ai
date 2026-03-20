import { useCallback, useEffect, useState } from "react";
import {
  fetchHabit,
  fetchHabitStats,
  completeHabit as apiCompleteHabit,
  deleteCompletion as apiDeleteCompletion,
  updateCompletion as apiUpdateCompletion,
  type Habit,
  type HabitStats,
} from "../api/habits";
import type { ApiError } from "../api/types";

type HabitDetailState = {
  habit: Habit | null;
  stats: HabitStats | null;
  loading: boolean;
  error: ApiError | null;
};

function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function useHabitDetail(habitId: string) {
  const [state, setState] = useState<HabitDetailState>({
    habit: null,
    stats: null,
    loading: true,
    error: null,
  });

  const timezone = getUserTimezone();

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [habit, stats] = await Promise.all([
        fetchHabit(habitId),
        fetchHabitStats(habitId, timezone),
      ]);
      setState({ habit, stats, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, [habitId, timezone]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, refresh: load, timezone };
}

type CompletionMutationState = {
  loading: boolean;
  error: ApiError | null;
};

export function useToggleCompletion(
  habitId: string,
  timezone: string,
  onSuccess?: () => void,
) {
  const [state, setState] = useState<CompletionMutationState>({
    loading: false,
    error: null,
  });

  const complete = useCallback(
    async (date: string) => {
      setState({ loading: true, error: null });
      try {
        await apiCompleteHabit(habitId, { date, timezone });
        setState({ loading: false, error: null });
        onSuccess?.();
      } catch (err) {
        setState({ loading: false, error: err as ApiError });
        throw err;
      }
    },
    [habitId, timezone, onSuccess],
  );

  const uncomplete = useCallback(
    async (date: string) => {
      setState({ loading: true, error: null });
      try {
        await apiDeleteCompletion(habitId, date);
        setState({ loading: false, error: null });
        onSuccess?.();
      } catch (err) {
        setState({ loading: false, error: err as ApiError });
        throw err;
      }
    },
    [habitId, onSuccess],
  );

  const updateKind = useCallback(
    async (date: string, completionKind: number) => {
      setState({ loading: true, error: null });
      try {
        await apiUpdateCompletion(habitId, date, completionKind);
        setState({ loading: false, error: null });
        onSuccess?.();
      } catch (err) {
        setState({ loading: false, error: err as ApiError });
        throw err;
      }
    },
    [habitId, onSuccess],
  );

  return { ...state, complete, uncomplete, updateKind };
}
