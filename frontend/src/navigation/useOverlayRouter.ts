import { useReducer, useCallback, useMemo } from "react";
import type { Habit } from "../api/habits";

export type OverlayType =
  | "editProfile"
  | "habitDetail"
  | "editHabit"
  | "notifications"
  | "habits"
  | "addFriend"
  | "friendProfile"
  | "createChallenge"
  | "challenges"
  | "settings"
  | "stats"
  | "witnessLinks";

export type OverlayParams = {
  habitId?: string;
  friendId?: string;
  friendName?: string;
  editHabitData?: Habit;
};

type OverlayEntry = {
  type: OverlayType;
  params: OverlayParams;
};

type OverlayState = {
  stack: OverlayEntry[];
};

type Action =
  | { kind: "PUSH"; type: OverlayType; params?: OverlayParams }
  | { kind: "POP" }
  | { kind: "REPLACE"; type: OverlayType; params?: OverlayParams }
  | { kind: "CLOSE_ALL" };

function overlayReducer(state: OverlayState, action: Action): OverlayState {
  switch (action.kind) {
    case "PUSH":
      return {
        stack: [
          ...state.stack,
          { type: action.type, params: action.params ?? {} },
        ],
      };
    case "POP":
      return { stack: state.stack.slice(0, -1) };
    case "REPLACE": {
      const next = state.stack.slice(0, -1);
      next.push({ type: action.type, params: action.params ?? {} });
      return { stack: next };
    }
    case "CLOSE_ALL":
      return { stack: [] };
  }
}

const initialState: OverlayState = { stack: [] };

export function useOverlayRouter() {
  const [state, dispatch] = useReducer(overlayReducer, initialState);

  const top = state.stack.length > 0 ? state.stack[state.stack.length - 1] : null;

  const push = useCallback(
    (type: OverlayType, params?: OverlayParams) =>
      dispatch({ kind: "PUSH", type, params }),
    [],
  );

  const pop = useCallback(() => dispatch({ kind: "POP" }), []);

  const replace = useCallback(
    (type: OverlayType, params?: OverlayParams) =>
      dispatch({ kind: "REPLACE", type, params }),
    [],
  );

  const closeAll = useCallback(() => dispatch({ kind: "CLOSE_ALL" }), []);

  return useMemo(
    () => ({
      current: top?.type ?? null,
      params: top?.params ?? {},
      push,
      pop,
      replace,
      closeAll,
    }),
    [top, push, pop, replace, closeAll],
  );
}
