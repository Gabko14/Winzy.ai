import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchUnreadCount } from "../api/notifications";
import { queryKeys } from "../api/queryKeys";

const POLL_INTERVAL_MS = 30_000;

/**
 * Unread notification badge count — TanStack query with the same 30s poll
 * cadence as the previous hand-rolled hook. Mark-read mutations invalidate
 * this key; decrementBy/resetToZero remain for optimistic badge UX.
 */
export function useUnreadCount(isAuthenticated = true) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: fetchUnreadCount,
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  const count = isAuthenticated ? (query.data?.unreadCount ?? 0) : 0;

  const decrementBy = useCallback(
    (n: number) => {
      queryClient.setQueryData<{ unreadCount: number }>(
        queryKeys.notifications.unreadCount(),
        (prev) => ({ unreadCount: Math.max(0, (prev?.unreadCount ?? 0) - n) }),
      );
    },
    [queryClient],
  );

  const resetToZero = useCallback(() => {
    queryClient.setQueryData(queryKeys.notifications.unreadCount(), { unreadCount: 0 });
  }, [queryClient]);

  const refresh = useCallback(() => {
    if (!isAuthenticated) return;
    void query.refetch();
  }, [isAuthenticated, query]);

  return { count, decrementBy, resetToZero, refresh };
}
