import { useCallback } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchHabits,
  createHabit as apiCreateHabit,
  updateHabit as apiUpdateHabit,
  archiveHabit as apiArchiveHabit,
  orderHabits as apiOrderHabits,
  type Habit,
  type CreateHabitRequest,
  type UpdateHabitRequest,
} from "../api/habits";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

/** Single shared queryFn for the habits list — useHabits and useTodayHabits both use this. */
export function habitsListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.habits.list(),
    queryFn: fetchHabits,
  });
}

function applyLocalOrder(list: Habit[], orderedIds: string[]): Habit[] {
  const byId = new Map(list.map((h) => [h.id, h]));
  return orderedIds
    .map((id, index) => {
      const habit = byId.get(id);
      return habit ? { ...habit, position: index } : null;
    })
    .filter((h): h is Habit => h != null);
}

export function useHabits() {
  const query = useQuery(habitsListQueryOptions());

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    habits: query.data ?? [],
    loading: query.isPending,
    error: (query.error as ApiError | null) ?? null,
    refresh,
  };
}

export function useOrderHabits() {
  const queryClient = useQueryClient();

  const order = useCallback(
    async (habitIds: string[]) => {
      const listKey = queryKeys.habits.list();
      const previous = queryClient.getQueryData<Habit[]>(listKey);
      queryClient.setQueryData<Habit[]>(listKey, (old) =>
        old ? applyLocalOrder(old, habitIds) : old,
      );
      try {
        await apiOrderHabits({ habitIds });
        await queryClient.invalidateQueries({ queryKey: listKey });
      } catch (err) {
        if (previous !== undefined) {
          queryClient.setQueryData(listKey, previous);
        } else {
          await queryClient.invalidateQueries({ queryKey: listKey });
        }
        throw err;
      }
    },
    [queryClient],
  );

  return { order };
}

export function useCreateHabit(onSuccess?: (habit: Habit) => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (request: CreateHabitRequest) => apiCreateHabit(request),
    onSuccess: async (habit) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() });
      onSuccess?.(habit);
    },
  });

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    create: mutation.mutateAsync,
  };
}

export function useUpdateHabit(onSuccess?: (habit: Habit) => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, request }: { id: string; request: UpdateHabitRequest }) =>
      apiUpdateHabit(id, request),
    onSuccess: async (habit) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.habits.detail(habit.id) }),
      ]);
      onSuccess?.(habit);
    },
  });

  const update = useCallback(
    async (id: string, request: UpdateHabitRequest) =>
      mutation.mutateAsync({ id, request }),
    [mutation.mutateAsync],
  );

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    update,
  };
}

export function useArchiveHabit(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiArchiveHabit(id),
    onSuccess: async (_data, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.habits.detail(id) }),
      ]);
      onSuccess?.();
    },
  });

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    archive: mutation.mutateAsync,
  };
}
