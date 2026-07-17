import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchTodos,
  createTodo as apiCreateTodo,
  completeTodo as apiCompleteTodo,
  uncompleteTodo as apiUncompleteTodo,
  updateTodo as apiUpdateTodo,
  deleteTodo as apiDeleteTodo,
  orderTodos as apiOrderTodos,
  type Todo,
  type CreateTodoRequest,
  type UpdateTodoRequest,
} from "../api/todos";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";
import { isApiError } from "../api/types";
import { localTodayISO } from "../utils/completionCycle";

const EXIT_LINGER_MS = 450;

export type TodayTodoBucket = "overdue" | "due_today" | "undated";

export type TodayTodoItem = {
  todo: Todo;
  bucket: TodayTodoBucket;
  /** Optimistic complete — still visible until slide-out finishes. */
  exiting: boolean;
};

type ExitSnap = { todo: Todo; bucket: TodayTodoBucket };

export function todosListQueryOptions(status: "open" | "completed" | "all" = "open") {
  return queryOptions({
    queryKey: queryKeys.todos.list(status),
    queryFn: () => fetchTodos(status),
  });
}

export function classifyTodoForToday(todo: Todo, today: string): TodayTodoBucket | null {
  if (todo.completedAt != null) return null;
  if (todo.dueDate == null) return "undated";
  if (todo.dueDate === today) return "due_today";
  if (todo.dueDate < today) return "overdue";
  return null;
}

export function weekdayShortLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
}

function sortTodayItems(a: TodayTodoItem, b: TodayTodoItem): number {
  const order: Record<TodayTodoBucket, number> = {
    overdue: 0,
    due_today: 1,
    undated: 2,
  };
  const bucketDiff = order[a.bucket] - order[b.bucket];
  if (bucketDiff !== 0) return bucketDiff;
  if (a.todo.position !== b.todo.position) return a.todo.position - b.todo.position;
  return a.todo.id.localeCompare(b.todo.id);
}

function removeFromOpenList(list: Todo[] | undefined, id: string): Todo[] | undefined {
  if (!list) return list;
  return list.filter((t) => t.id !== id);
}

export function useTodosToday() {
  const queryClient = useQueryClient();
  const today = localTodayISO();
  const openKey = queryKeys.todos.list("open");

  const [forceShow, setForceShow] = useState(false);
  const exitingRef = useRef<Map<string, ExitSnap>>(new Map());
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [exitEpoch, setExitEpoch] = useState(0);

  const query = useQuery(todosListQueryOptions("open"));

  useEffect(() => {
    return () => {
      for (const timer of exitTimers.current.values()) {
        clearTimeout(timer);
      }
      exitTimers.current.clear();
    };
  }, []);

  const bumpExit = useCallback(() => setExitEpoch((n) => n + 1), []);

  const clearExitTimer = useCallback((id: string) => {
    const timer = exitTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      exitTimers.current.delete(id);
    }
  }, []);

  const cancelExit = useCallback(
    (id: string) => {
      clearExitTimer(id);
      if (exitingRef.current.delete(id)) bumpExit();
    },
    [clearExitTimer, bumpExit],
  );

  const scheduleExit = useCallback(
    (todo: Todo, bucket: TodayTodoBucket) => {
      clearExitTimer(todo.id);
      exitingRef.current.set(todo.id, {
        todo: { ...todo, completedAt: new Date().toISOString() },
        bucket,
      });
      bumpExit();
      const timer = setTimeout(() => {
        exitTimers.current.delete(todo.id);
        exitingRef.current.delete(todo.id);
        bumpExit();
        queryClient.setQueryData<Todo[]>(openKey, (old) => removeFromOpenList(old, todo.id));
      }, EXIT_LINGER_MS);
      exitTimers.current.set(todo.id, timer);
    },
    [clearExitTimer, bumpExit, openKey, queryClient],
  );

  const items = useMemo(() => {
    void exitEpoch;
    const raw = query.data ?? [];
    const seen = new Set<string>();
    const out: TodayTodoItem[] = [];

    for (const todo of raw) {
      const snap = exitingRef.current.get(todo.id);
      if (snap) {
        out.push({ todo: snap.todo, bucket: snap.bucket, exiting: true });
        seen.add(todo.id);
        continue;
      }
      const bucket = classifyTodoForToday(todo, today);
      if (!bucket) continue;
      out.push({ todo, bucket, exiting: false });
      seen.add(todo.id);
    }

    for (const [id, snap] of exitingRef.current) {
      if (seen.has(id)) continue;
      out.push({ todo: snap.todo, bucket: snap.bucket, exiting: true });
    }

    return out.sort(sortTodayItems);
  }, [query.data, today, exitEpoch]);

  const createMutation = useMutation({
    mutationFn: (request: CreateTodoRequest) => apiCreateTodo(request),
    onSuccess: (todo) => {
      queryClient.setQueryData<Todo[]>(openKey, (old) => {
        if (!old) return [todo];
        return [...old, todo];
      });
      setForceShow(true);
      void queryClient.invalidateQueries({ queryKey: openKey });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiCompleteTodo(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: openKey });
      const previous = queryClient.getQueryData<Todo[]>(openKey);
      const todo = previous?.find((t) => t.id === id);
      if (todo) {
        const bucket = classifyTodoForToday(todo, today) ?? "undated";
        scheduleExit(todo, bucket);
      }
      return { previous };
    },
    onError: (_err, id, ctx) => {
      cancelExit(id);
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(openKey, ctx.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: openKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.todos.list("completed") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.todos.list("all") });
    },
  });

  const uncompleteMutation = useMutation({
    mutationFn: (id: string) => apiUncompleteTodo(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: openKey });
      const previous = queryClient.getQueryData<Todo[]>(openKey);
      const snap = exitingRef.current.get(id);
      cancelExit(id);
      if (snap) {
        queryClient.setQueryData<Todo[]>(openKey, (old) => {
          const restored = { ...snap.todo, completedAt: null };
          if (!old) return [restored];
          if (old.some((t) => t.id === id)) {
            return old.map((t) => (t.id === id ? restored : t));
          }
          return [...old, restored];
        });
      }
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(openKey, ctx.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: openKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.todos.list("completed") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.todos.list("all") });
    },
  });

  const toggleComplete = useCallback(
    async (id: string) => {
      if (exitingRef.current.has(id)) {
        try {
          await uncompleteMutation.mutateAsync(id);
        } catch {
          // onError restores
        }
        return;
      }
      const todo = (query.data ?? []).find((t) => t.id === id);
      if (!todo || todo.completedAt != null) return;
      try {
        await completeMutation.mutateAsync(id);
      } catch {
        // onError restores
      }
    },
    [query.data, completeMutation, uncompleteMutation],
  );

  const quickAdd = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return null;
      return createMutation.mutateAsync({ title: trimmed });
    },
    [createMutation],
  );

  const showComposer = useCallback(() => setForceShow(true), []);

  const visible = items.length > 0 || forceShow;

  return {
    items,
    today,
    visible,
    forceShow,
    loading: query.isPending,
    error: (query.error as ApiError | null) ?? null,
    creating: createMutation.isPending,
    showComposer,
    toggleComplete,
    quickAdd,
    refresh: () => query.refetch(),
  };
}

/**
 * Reapply a user's intended open-todo order onto a freshly fetched list.
 * Keeps intended relative order for ids that still exist; appends any new
 * open ids (from another device) at the end.
 */
export function reapplyOrderIntent(intendedIds: string[], freshOpen: Todo[]): string[] {
  const freshIds = freshOpen.map((t) => t.id);
  const freshSet = new Set(freshIds);
  const kept = intendedIds.filter((id) => freshSet.has(id));
  const extras = freshIds.filter((id) => !kept.includes(id));
  return [...kept, ...extras];
}

function sortOpenByPosition(a: Todo, b: Todo): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id.localeCompare(b.id);
}

function sortCompletedDesc(a: Todo, b: Todo): number {
  const ac = a.completedAt ?? "";
  const bc = b.completedAt ?? "";
  if (ac !== bc) return bc.localeCompare(ac);
  return b.id.localeCompare(a.id);
}

function applyLocalOrder(list: Todo[], orderedIds: string[]): Todo[] {
  const byId = new Map(list.map((t) => [t.id, t]));
  return orderedIds
    .map((id, index) => {
      const todo = byId.get(id);
      return todo ? { ...todo, position: index } : null;
    })
    .filter((t): t is Todo => t != null);
}

export function useTodosManage() {
  const queryClient = useQueryClient();
  const openKey = queryKeys.todos.list("open");
  const completedKey = queryKeys.todos.list("completed");

  const openQuery = useQuery(todosListQueryOptions("open"));
  const completedQuery = useQuery(todosListQueryOptions("completed"));

  const openTodos = useMemo(
    () => [...(openQuery.data ?? [])].sort(sortOpenByPosition),
    [openQuery.data],
  );
  const completedTodos = useMemo(
    () => [...(completedQuery.data ?? [])].sort(sortCompletedDesc),
    [completedQuery.data],
  );

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: openKey });
    void queryClient.invalidateQueries({ queryKey: completedKey });
    void queryClient.invalidateQueries({ queryKey: queryKeys.todos.list("all") });
  }, [queryClient, openKey, completedKey]);

  const updateMutation = useMutation({
    mutationFn: ({ id, request }: { id: string; request: UpdateTodoRequest }) =>
      apiUpdateTodo(id, request),
    onSuccess: (todo) => {
      queryClient.setQueryData<Todo[]>(openKey, (old) => {
        if (!old) return old;
        return old.map((t) => (t.id === todo.id ? todo : t));
      });
      invalidateAll();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDeleteTodo(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: openKey });
      await queryClient.cancelQueries({ queryKey: completedKey });
      const prevOpen = queryClient.getQueryData<Todo[]>(openKey);
      const prevCompleted = queryClient.getQueryData<Todo[]>(completedKey);
      queryClient.setQueryData<Todo[]>(openKey, (old) => removeFromOpenList(old, id));
      queryClient.setQueryData<Todo[]>(completedKey, (old) => removeFromOpenList(old, id));
      return { prevOpen, prevCompleted };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevOpen !== undefined) queryClient.setQueryData(openKey, ctx.prevOpen);
      if (ctx?.prevCompleted !== undefined) {
        queryClient.setQueryData(completedKey, ctx.prevCompleted);
      }
    },
    onSettled: () => invalidateAll(),
  });

  const uncompleteMutation = useMutation({
    mutationFn: (id: string) => apiUncompleteTodo(id),
    onSuccess: (todo) => {
      queryClient.setQueryData<Todo[]>(completedKey, (old) => removeFromOpenList(old, todo.id));
      queryClient.setQueryData<Todo[]>(openKey, (old) => {
        if (!old) return [todo];
        if (old.some((t) => t.id === todo.id)) {
          return old.map((t) => (t.id === todo.id ? todo : t));
        }
        return [...old, todo];
      });
      invalidateAll();
    },
  });

  const orderTodos = useCallback(
    async (intendedIds: string[]): Promise<{ retried: boolean }> => {
      try {
        await apiOrderTodos({ todoIds: intendedIds });
        queryClient.setQueryData<Todo[]>(openKey, (old) =>
          old ? applyLocalOrder(old, intendedIds) : old,
        );
        invalidateAll();
        return { retried: false };
      } catch (err) {
        if (!isApiError(err) || err.code !== "conflict") {
          throw err;
        }
        const fresh = await fetchTodos("open");
        queryClient.setQueryData(openKey, fresh);
        const retryIds = reapplyOrderIntent(intendedIds, fresh);
        try {
          await apiOrderTodos({ todoIds: retryIds });
          queryClient.setQueryData<Todo[]>(openKey, (old) =>
            old ? applyLocalOrder(old, retryIds) : applyLocalOrder(fresh, retryIds),
          );
          invalidateAll();
          return { retried: true };
        } catch (err2) {
          invalidateAll();
          throw err2;
        }
      }
    },
    [queryClient, openKey, invalidateAll],
  );

  return {
    openTodos,
    completedTodos,
    loading: openQuery.isPending || completedQuery.isPending,
    error: (openQuery.error as ApiError | null) ?? (completedQuery.error as ApiError | null) ?? null,
    updating: updateMutation.isPending,
    deleting: deleteMutation.isPending,
    ordering: false,
    update: (id: string, request: UpdateTodoRequest) =>
      updateMutation.mutateAsync({ id, request }),
    remove: (id: string) => deleteMutation.mutateAsync(id),
    uncomplete: (id: string) => uncompleteMutation.mutateAsync(id),
    orderTodos,
    refresh: async () => {
      await Promise.all([openQuery.refetch(), completedQuery.refetch()]);
    },
  };
}
