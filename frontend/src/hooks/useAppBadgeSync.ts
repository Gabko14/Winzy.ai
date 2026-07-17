import { useEffect } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCompletionsRange } from "../api/habits";
import { queryKeys } from "../api/queryKeys";
import { habitsListQueryOptions } from "./useHabits";
import {
  applyAppBadge,
  countDueIncompleteHabits,
  syncAppBadgeFromCache,
} from "../utils/appBadge";
import { localTodayISO, weekStripRange } from "../utils/completionCycle";

/**
 * Keeps the PWA app-icon badge in sync with due-today incomplete habits.
 * Triggers: habits/range cache updates, app foreground, and visibility change.
 */
export function useAppBadgeSync(isAuthenticated: boolean) {
  const queryClient = useQueryClient();
  const enabled = isAuthenticated && Platform.OS === "web";
  const today = localTodayISO();
  const { from, to } = weekStripRange(today);

  const habitsQuery = useQuery({
    ...habitsListQueryOptions(),
    enabled,
  });

  const rangeQuery = useQuery({
    queryKey: queryKeys.completions.range(from, to),
    queryFn: () => fetchCompletionsRange(from, to),
    enabled: enabled && habitsQuery.isSuccess,
  });

  useEffect(() => {
    if (!enabled || !habitsQuery.data) return;
    void applyAppBadge(
      countDueIncompleteHabits(habitsQuery.data, rangeQuery.data, today),
    );
  }, [enabled, habitsQuery.data, rangeQuery.data, today]);

  useEffect(() => {
    if (!enabled) return;

    const sync = () => {
      void syncAppBadgeFromCache(queryClient, today);
    };

    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        sync();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    const onAppState = (status: AppStateStatus) => {
      if (status === "active") sync();
    };
    const appSub = AppState.addEventListener("change", onAppState);

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      appSub.remove();
    };
  }, [enabled, queryClient, today]);
}
