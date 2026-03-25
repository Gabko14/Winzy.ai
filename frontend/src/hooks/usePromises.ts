import { useCallback, useEffect, useState } from "react";
import {
  fetchPromise,
  createPromise as apiCreatePromise,
  cancelPromise as apiCancelPromise,
  togglePromiseVisibility as apiToggleVisibility,
  type PromiseResponse,
  type CreatePromiseRequest,
} from "../api/promises";
import type { ApiError } from "../api/types";

type PromiseState = {
  data: PromiseResponse | null;
  loading: boolean;
  error: ApiError | null;
};

export function usePromises(habitId: string, timezone: string) {
  const [state, setState] = useState<PromiseState>({
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchPromise(habitId, timezone, true);
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, [habitId, timezone]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (request: CreatePromiseRequest) => {
      await apiCreatePromise(habitId, request, timezone);
      await load();
    },
    [habitId, timezone, load],
  );

  const cancel = useCallback(async () => {
    await apiCancelPromise(habitId);
    await load();
  }, [habitId, load]);

  const toggleVisibility = useCallback(
    async (isPublicOnFlame: boolean) => {
      await apiToggleVisibility(habitId, isPublicOnFlame);
      await load();
    },
    [habitId, load],
  );

  return {
    ...state,
    refresh: load,
    create,
    cancel,
    toggleVisibility,
  };
}
