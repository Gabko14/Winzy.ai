import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * @param isAuthenticated - Gate fetch on auth status. When false, returns inert
 *   defaults without hitting the API so public/unauthenticated surfaces stay clean.
 */
export function useVisibility(isAuthenticated = true) {
  const [state, setState] = useState<VisibilityState>({
    visibilityMap: {},
    defaultVisibility: "private",
    loading: isAuthenticated,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data: BatchVisibilityResponse = await fetchVisibility();
      if (cancelledRef.current) return;
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
      if (cancelledRef.current) return;
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, []);

  // Track whether the current fetch cycle is still valid.
  // Prevents a slow in-flight fetch from overwriting the inert defaults
  // that the auth-drop effect sets when isAuthenticated flips to false.
  const cancelledRef = useRef(false);

  // Reset to inert defaults when auth drops
  useEffect(() => {
    if (!isAuthenticated) {
      cancelledRef.current = true;
      setState({
        visibilityMap: {},
        defaultVisibility: "private",
        loading: false,
        error: null,
      });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    cancelledRef.current = false;
    load();
  }, [load, isAuthenticated]);

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
