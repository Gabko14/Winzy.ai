import { useCallback, useEffect, useState } from "react";
import {
  fetchVisibility,
  fetchPreferences,
  updateVisibility as apiUpdateVisibility,
  type HabitVisibility,
  type BatchVisibilityResponse,
} from "../api/visibility";
import type { ApiError } from "../api/types";

type VisibilityState = {
  /** Per-habit visibility map (habitId -> visibility) */
  visibilityMap: Record<string, HabitVisibility>;
  /** User's default visibility preference from Social Service */
  defaultVisibility: HabitVisibility;
  loading: boolean;
  error: ApiError | null;
};

/**
 * Fetches batch visibility for all of the user's habits and the default preference.
 * Returns a map of habitId -> visibility, plus the default.
 */
export function useVisibility() {
  const [state, setState] = useState<VisibilityState>({
    visibilityMap: {},
    defaultVisibility: "private",
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data: BatchVisibilityResponse = await fetchVisibility();
      const map: Record<string, HabitVisibility> = {};
      for (const entry of data.habits) {
        map[entry.habitId] = entry.visibility;
      }
      setState({
        visibilityMap: map,
        defaultVisibility: data.defaultVisibility,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Get visibility for a specific habit, falling back to the user's default */
  const getVisibility = useCallback(
    (habitId: string): HabitVisibility => {
      return state.visibilityMap[habitId] ?? state.defaultVisibility;
    },
    [state.visibilityMap, state.defaultVisibility],
  );

  return { ...state, refresh: load, getVisibility };
}

type DefaultVisibilityState = {
  defaultVisibility: HabitVisibility;
  loading: boolean;
  error: ApiError | null;
};

/**
 * Fetches just the user's default habit visibility preference.
 * Used by the create-habit flow to know what the initial toggle value should be.
 */
export function useDefaultVisibility() {
  const [state, setState] = useState<DefaultVisibilityState>({
    defaultVisibility: "private",
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await fetchPreferences();
        if (!cancelled) {
          setState({
            defaultVisibility: prefs.defaultHabitVisibility,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          // Fall back to private when Social Service is unavailable
          setState({
            defaultVisibility: "private",
            loading: false,
            error: err as ApiError,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

type UpdateVisibilityState = {
  loading: boolean;
  error: ApiError | null;
};

/**
 * Mutation hook for updating a single habit's visibility.
 */
export function useUpdateVisibility(onSuccess?: () => void) {
  const [state, setState] = useState<UpdateVisibilityState>({
    loading: false,
    error: null,
  });

  const update = useCallback(
    async (habitId: string, visibility: HabitVisibility) => {
      setState({ loading: true, error: null });
      try {
        await apiUpdateVisibility(habitId, visibility);
        setState({ loading: false, error: null });
        onSuccess?.();
      } catch (err) {
        setState({ loading: false, error: err as ApiError });
        throw err;
      }
    },
    [onSuccess],
  );

  return { ...state, update };
}
