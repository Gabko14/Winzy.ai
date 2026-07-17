import { useCallback, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
} from "../api/notifications";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function useNotifications(pageSize = 20) {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: queryKeys.notifications.list(pageSize),
    queryFn: ({ pageParam }) => fetchNotifications(pageParam, pageSize),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.pageSize;
      if (loaded >= lastPage.total) return undefined;
      return lastPage.page + 1;
    },
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? 0;

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [query]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.list(pageSize) });
      const previous = queryClient.getQueryData(queryKeys.notifications.list(pageSize));
      queryClient.setQueryData(queryKeys.notifications.list(pageSize), (old: typeof query.data) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
            ),
          })),
        };
      });
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(queryKeys.notifications.list(pageSize), ctx.previous);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(pageSize) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() }),
      ]);
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.list(pageSize) });
      const previous = queryClient.getQueryData(queryKeys.notifications.list(pageSize));
      const stamp = new Date().toISOString();
      queryClient.setQueryData(queryKeys.notifications.list(pageSize), (old: typeof query.data) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.readAt ? item : { ...item, readAt: stamp },
            ),
          })),
        };
      });
      queryClient.setQueryData(queryKeys.notifications.unreadCount(), { unreadCount: 0 });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(queryKeys.notifications.list(pageSize), ctx.previous);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(pageSize) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() }),
      ]);
    },
  });

  const markRead = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await markReadMutation.mutateAsync(id);
        return true;
      } catch {
        return false;
      }
    },
    [markReadMutation],
  );

  const markAllRead = useCallback(async (): Promise<boolean> => {
    try {
      await markAllMutation.mutateAsync();
      return true;
    } catch {
      return false;
    }
  }, [markAllMutation]);

  return {
    items: items as NotificationItem[],
    total,
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    error: (query.error as ApiError | null) ?? null,
    hasMore: Boolean(query.hasNextPage),
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };
}
