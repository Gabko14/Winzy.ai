import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchHabit,
  fetchHabitStats,
  completeHabit as apiCompleteHabit,
  deleteCompletion as apiDeleteCompletion,
  updateCompletion as apiUpdateCompletion,
  type CompletionKind,
} from "../api/habits";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";
import { syncAppBadgeFromCache } from "../utils/appBadge";
import { localTodayISO, weekStripRange } from "../utils/completionCycle";

function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function useHabitDetail(habitId: string) {
  const queryClient = useQueryClient();
  const timezone = getUserTimezone();

  const habitQuery = useQuery({
    queryKey: queryKeys.habits.detail(habitId),
    queryFn: () => fetchHabit(habitId),
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.habits.stats(habitId, timezone),
    queryFn: () => fetchHabitStats(habitId, timezone),
    enabled: habitQuery.isSuccess,
  });

  const loading =
    habitQuery.isPending || (habitQuery.isSuccess && statsQuery.isPending);
  const error = (habitQuery.error ?? statsQuery.error) as ApiError | null;

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.habits.detail(habitId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.habits.stats(habitId, timezone) }),
    ]);
  }, [queryClient, habitId, timezone]);

  return {
    habit: habitQuery.data ?? null,
    stats: statsQuery.data ?? null,
    loading,
    error: error ?? null,
    refresh,
    timezone,
  };
}

export function useToggleCompletion(
  habitId: string,
  timezone: string,
  onSuccess?: () => void,
) {
  const queryClient = useQueryClient();

  const invalidateRelated = useCallback(async () => {
    const today = localTodayISO();
    const { from, to } = weekStripRange(today);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.habits.stats(habitId, timezone) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.habits.detail(habitId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.completions.range(from, to) }),
    ]);
    await syncAppBadgeFromCache(queryClient, today);
  }, [queryClient, habitId, timezone]);

  const completeMutation = useMutation({
    mutationFn: (date: string) => apiCompleteHabit(habitId, { date, timezone }),
    onSuccess: async () => {
      await invalidateRelated();
      onSuccess?.();
    },
  });

  const uncompleteMutation = useMutation({
    mutationFn: (date: string) => apiDeleteCompletion(habitId, date),
    onSuccess: async () => {
      await invalidateRelated();
      onSuccess?.();
    },
  });

  const updateKindMutation = useMutation({
    mutationFn: ({ date, completionKind }: { date: string; completionKind: CompletionKind }) =>
      apiUpdateCompletion(habitId, date, completionKind),
    onSuccess: async () => {
      await invalidateRelated();
      onSuccess?.();
    },
  });

  const complete = useCallback(
    async (date: string) => completeMutation.mutateAsync(date),
    [completeMutation],
  );

  const uncomplete = useCallback(
    async (date: string) => uncompleteMutation.mutateAsync(date),
    [uncompleteMutation],
  );

  const updateKind = useCallback(
    async (date: string, completionKind: CompletionKind) =>
      updateKindMutation.mutateAsync({ date, completionKind }),
    [updateKindMutation],
  );

  const loading =
    completeMutation.isPending || uncompleteMutation.isPending || updateKindMutation.isPending;
  const error = (completeMutation.error ??
    uncompleteMutation.error ??
    updateKindMutation.error) as ApiError | null;

  return { loading, error: error ?? null, complete, uncomplete, updateKind };
}
