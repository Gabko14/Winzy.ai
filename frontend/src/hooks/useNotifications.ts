import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
} from "../api/notifications";
import type { ApiError } from "../api/types";

type NotificationsState = {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
};

export function useNotifications(pageSize = 20) {
  const [state, setState] = useState<NotificationsState>({
    items: [],
    page: 1,
    pageSize,
    total: 0,
    loading: true,
    loadingMore: false,
    error: null,
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (page: number, append: boolean) => {
      if (!append) {
        setState((s) => ({ ...s, loading: true, error: null }));
      } else {
        setState((s) => ({ ...s, loadingMore: true }));
      }

      try {
        const data = await fetchNotifications(page, pageSize);
        if (!mountedRef.current) return;

        setState((s) => ({
          ...s,
          items: append ? [...s.items, ...data.items] : data.items,
          page: data.page,
          pageSize: data.pageSize,
          total: data.total,
          loading: false,
          loadingMore: false,
          error: null,
        }));
      } catch (err) {
        if (!mountedRef.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          loadingMore: false,
          error: err as ApiError,
        }));
      }
    },
    [pageSize],
  );

  // Initial load
  useEffect(() => {
    load(1, false);
  }, [load]);

  const refresh = useCallback(() => load(1, false), [load]);

  const loadMore = useCallback(() => {
    const hasMore = state.items.length < state.total;
    if (!hasMore || state.loadingMore) return;
    load(state.page + 1, true);
  }, [load, state.items.length, state.total, state.loadingMore, state.page]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic update
    setState((s) => ({
      ...s,
      items: s.items.map((item) =>
        item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    }));

    try {
      const updated = await markNotificationRead(id);
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        items: s.items.map((item) => (item.id === id ? updated : item)),
      }));
    } catch {
      if (!mountedRef.current) return;
      // Revert optimistic update
      setState((s) => ({
        ...s,
        items: s.items.map((item) =>
          item.id === id ? { ...item, readAt: null } : item,
        ),
      }));
    }
  }, []);

  const markAllRead = useCallback(async () => {
    // Capture snapshot inside setState to avoid stale closure
    let previousItems: NotificationItem[] = [];
    setState((s) => {
      previousItems = s.items;
      return {
        ...s,
        items: s.items.map((item) =>
          item.readAt ? item : { ...item, readAt: new Date().toISOString() },
        ),
      };
    });

    try {
      await markAllNotificationsRead();
    } catch {
      if (!mountedRef.current) return;
      // Revert to snapshot
      setState((s) => ({ ...s, items: previousItems }));
    }
  }, []);

  const hasMore = state.items.length < state.total;

  return {
    items: state.items,
    total: state.total,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    hasMore,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };
}
