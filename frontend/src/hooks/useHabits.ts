import { useCallback, useEffect, useState } from "react";
import {
  fetchHabits,
  createHabit as apiCreateHabit,
  updateHabit as apiUpdateHabit,
  archiveHabit as apiArchiveHabit,
  type Habit,
  type CreateHabitRequest,
  type UpdateHabitRequest,
} from "../api/habits";
import type { ApiError } from "../api/types";

type HabitsState = {
  habits: Habit[];
  loading: boolean;
  error: ApiError | null;
};

export function useHabits() {
  const [state, setState] = useState<HabitsState>({
    habits: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const habits = await fetchHabits();
      setState({ habits, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, refresh: load };
}

type MutationState = {
  loading: boolean;
  error: ApiError | null;
};

export function useCreateHabit(onSuccess?: (habit: Habit) => void) {
  const [state, setState] = useState<MutationState>({ loading: false, error: null });

  const create = useCallback(
    async (request: CreateHabitRequest) => {
      setState({ loading: true, error: null });
      try {
        const habit = await apiCreateHabit(request);
        setState({ loading: false, error: null });
        onSuccess?.(habit);
        return habit;
      } catch (err) {
        setState({ loading: false, error: err as ApiError });
        throw err;
      }
    },
    [onSuccess],
  );

  return { ...state, create };
}

export function useUpdateHabit(onSuccess?: (habit: Habit) => void) {
  const [state, setState] = useState<MutationState>({ loading: false, error: null });

  const update = useCallback(
    async (id: string, request: UpdateHabitRequest) => {
      setState({ loading: true, error: null });
      try {
        const habit = await apiUpdateHabit(id, request);
        setState({ loading: false, error: null });
        onSuccess?.(habit);
        return habit;
      } catch (err) {
        setState({ loading: false, error: err as ApiError });
        throw err;
      }
    },
    [onSuccess],
  );

  return { ...state, update };
}

export function useArchiveHabit(onSuccess?: () => void) {
  const [state, setState] = useState<MutationState>({ loading: false, error: null });

  const archive = useCallback(
    async (id: string) => {
      setState({ loading: true, error: null });
      try {
        await apiArchiveHabit(id);
        setState({ loading: false, error: null });
        onSuccess?.();
      } catch (err) {
        setState({ loading: false, error: err as ApiError });
        throw err;
      }
    },
    [onSuccess],
  );

  return { ...state, archive };
}
