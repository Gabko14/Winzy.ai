import { useCallback, useMemo } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchVisibility,
  fetchPreferences,
  updateVisibility as apiUpdateVisibility,
  type HabitVisibility,
  type BatchVisibilityResponse,
} from "../api/visibility";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function visibilityBatchQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.visibility.batch(),
    queryFn: fetchVisibility,
  });
}

export function visibilityPreferencesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.visibility.preferences(),
    queryFn: fetchPreferences,
  });
}

/**
 * Fetches batch visibility for all of the user's habits and the default preference.
 * Returns a map of habitId -> visibility, plus the default.
 *
 * @param isAuthenticated - Gate fetch on auth status. When false, returns inert
 *   defaults without hitting the API so public/unauthenticated surfaces stay clean.
 */
export function useVisibility(isAuthenticated = true) {
  const queryClient = useQueryClient();

  const query = useQuery({
    ...visibilityBatchQueryOptions(),
    enabled: isAuthenticated,
  });

  const visibilityMap = useMemo(() => {
    const map: Record<string, HabitVisibility> = {};
    if (query.data) {
      for (const entry of query.data.habits) {
        map[entry.habitId] = entry.visibility;
      }
    }
    return map;
  }, [query.data]);

  const defaultVisibility: HabitVisibility = query.data?.defaultVisibility ?? "private";

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.visibility.batch() });
  }, [queryClient]);

  const getVisibility = useCallback(
    (habitId: string): HabitVisibility => {
      return visibilityMap[habitId] ?? defaultVisibility;
    },
    [visibilityMap, defaultVisibility],
  );

  return {
    visibilityMap: isAuthenticated ? visibilityMap : {},
    defaultVisibility: isAuthenticated ? defaultVisibility : ("private" as HabitVisibility),
    loading: isAuthenticated && query.isPending,
    error: isAuthenticated ? ((query.error as ApiError | null) ?? null) : null,
    refresh,
    getVisibility,
  };
}

/**
 * Fetches just the user's default habit visibility preference.
 * Used by the create-habit flow to know what the initial toggle value should be.
 */
export function useDefaultVisibility() {
  const query = useQuery(visibilityPreferencesQueryOptions());

  return {
    defaultVisibility: (query.data?.defaultHabitVisibility ?? "private") as HabitVisibility,
    loading: query.isPending,
    error: (query.error as ApiError | null) ?? null,
  };
}

/**
 * Mutation hook for updating a single habit's visibility.
 */
export function useUpdateVisibility(onSuccess?: () => void) {
  const mutation = useMutation({
    mutationFn: ({ habitId, visibility }: { habitId: string; visibility: HabitVisibility }) =>
      apiUpdateVisibility(habitId, visibility),
    onMutate: async ({ habitId, visibility }, { client }) => {
      await client.cancelQueries({ queryKey: queryKeys.visibility.batch() });
      const previous = client.getQueryData<BatchVisibilityResponse>(queryKeys.visibility.batch());
      if (previous) {
        const habits = previous.habits.some((h) => h.habitId === habitId)
          ? previous.habits.map((h) => (h.habitId === habitId ? { ...h, visibility } : h))
          : [...previous.habits, { habitId, visibility }];
        client.setQueryData<BatchVisibilityResponse>(queryKeys.visibility.batch(), {
          ...previous,
          habits,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(queryKeys.visibility.batch(), onMutateResult.previous);
      }
    },
    onSuccess: async () => {
      onSuccess?.();
    },
    onSettled: (_data, _error, _vars, _onMutateResult, { client }) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.visibility.batch() }),
        client.invalidateQueries({ queryKey: ["friend"] }),
        client.invalidateQueries({ queryKey: queryKeys.witnessLinks.list() }),
        client.invalidateQueries({ queryKey: ["witness"] }),
      ]);
    },
  });

  const update = useCallback(
    async (habitId: string, visibility: HabitVisibility) =>
      mutation.mutateAsync({ habitId, visibility }),
    [mutation.mutateAsync],
  );

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    update,
  };
}
