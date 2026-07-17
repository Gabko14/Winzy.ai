import { useReducer, useCallback, useMemo, useRef } from "react";
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

export type OverlayHistoryBridge = {
  onAfterPush: () => void;
  interceptPop: () => boolean;
  beforeCloseAll: (depth: number) => void;
};

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

export function useOverlayRouter(bridge?: OverlayHistoryBridge) {
  const [state, dispatch] = useReducer(overlayReducer, initialState);
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const depthRef = useRef(0);
  depthRef.current = state.stack.length;

  const top = state.stack.length > 0 ? state.stack[state.stack.length - 1] : null;

  const push = useCallback(
    (type: OverlayType, params?: OverlayParams) => {
      dispatch({ kind: "PUSH", type, params });
      bridgeRef.current?.onAfterPush();
    },
    [],
  );

  const pop = useCallback(() => {
    if (bridgeRef.current?.interceptPop()) return;
    dispatch({ kind: "POP" });
  }, []);

  const replace = useCallback(
    (type: OverlayType, params?: OverlayParams) =>
      dispatch({ kind: "REPLACE", type, params }),
    [],
  );

  const closeAll = useCallback(() => {
    bridgeRef.current?.beforeCloseAll(depthRef.current);
    dispatch({ kind: "CLOSE_ALL" });
  }, []);

  const applyPop = useCallback(() => dispatch({ kind: "POP" }), []);

  return useMemo(
    () => ({
      current: top?.type ?? null,
      params: top?.params ?? {},
      depth: state.stack.length,
      push,
      pop,
      replace,
      closeAll,
      applyPop,
    }),
    [top, state.stack.length, push, pop, replace, closeAll, applyPop],
  );
}
