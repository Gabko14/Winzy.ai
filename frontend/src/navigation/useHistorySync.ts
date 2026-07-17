import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { TabId } from "./TabBar";

export type WinzyHistoryKind = "base" | "tab" | "overlay";

export type WinzyHistoryState = {
  __winzy: 1;
  k: WinzyHistoryKind;
};

export type HistorySyncDeps = {
  isWeb: boolean;
  applyOverlayPop: () => void;
  applyReturnToToday: () => void;
  history?: Pick<History, "pushState" | "replaceState" | "back" | "go">;
  location?: Pick<Location, "pathname" | "search" | "hash">;
  addEventListener?: (type: "popstate", listener: (ev: PopStateEvent) => void) => void;
  removeEventListener?: (type: "popstate", listener: (ev: PopStateEvent) => void) => void;
};

type PendingTabChange = { from: TabId; to: TabId };

function currentUrl(location: Pick<Location, "pathname" | "search" | "hash">): string {
  return location.pathname + location.search + location.hash;
}

function baseState(): WinzyHistoryState {
  return { __winzy: 1, k: "base" };
}

function tabState(): WinzyHistoryState {
  return { __winzy: 1, k: "tab" };
}

function overlayState(): WinzyHistoryState {
  return { __winzy: 1, k: "overlay" };
}

export function createHistorySync(deps: HistorySyncDeps) {
  let suppressCount = 0;
  let overlayDepth = 0;
  let hasTabSentinel = false;
  let listening = false;
  let pendingTabChange: PendingTabChange | null = null;

  const hist = () => deps.history ?? window.history;
  const loc = () => deps.location ?? window.location;

  const addPopStateListener = (
    listener: (ev: PopStateEvent) => void,
  ) => {
    if (deps.addEventListener) {
      deps.addEventListener("popstate", listener);
      return;
    }
    window.addEventListener("popstate", listener as EventListener);
  };

  const removePopStateListener = (
    listener: (ev: PopStateEvent) => void,
  ) => {
    if (deps.removeEventListener) {
      deps.removeEventListener("popstate", listener);
      return;
    }
    window.removeEventListener("popstate", listener as EventListener);
  };

  function applyTabHistory(from: TabId, to: TabId) {
    if (from === to) return;
    if (to === "today") {
      if (hasTabSentinel) {
        hasTabSentinel = false;
        hist().replaceState(baseState(), "", currentUrl(loc()));
      }
      return;
    }
    if (from === "today") {
      hasTabSentinel = true;
      hist().pushState(tabState(), "", currentUrl(loc()));
      return;
    }
    hist().replaceState(tabState(), "", currentUrl(loc()));
  }

  function flushPendingTabChange() {
    if (!pendingTabChange) return;
    const { from, to } = pendingTabChange;
    pendingTabChange = null;
    applyTabHistory(from, to);
  }

  function onPopState(_ev: PopStateEvent) {
    if (suppressCount > 0) {
      suppressCount -= 1;
      if (suppressCount === 0) {
        flushPendingTabChange();
      }
      return;
    }

    if (overlayDepth > 0) {
      overlayDepth -= 1;
      deps.applyOverlayPop();
      return;
    }

    if (hasTabSentinel) {
      hasTabSentinel = false;
      deps.applyReturnToToday();
      return;
    }
  }

  return {
    get suppressCount() {
      return suppressCount;
    },
    get overlayDepth() {
      return overlayDepth;
    },
    get hasTabSentinel() {
      return hasTabSentinel;
    },
    get listening() {
      return listening;
    },

    start() {
      if (!deps.isWeb) return;
      if (listening) {
        this.stop();
      }
      hist().replaceState(baseState(), "", currentUrl(loc()));
      overlayDepth = 0;
      hasTabSentinel = false;
      suppressCount = 0;
      pendingTabChange = null;
      addPopStateListener(onPopState);
      listening = true;
    },

    stop() {
      if (!listening) return;
      removePopStateListener(onPopState);
      listening = false;
      overlayDepth = 0;
      hasTabSentinel = false;
      suppressCount = 0;
      pendingTabChange = null;
    },

    onOverlayPushed() {
      if (!deps.isWeb || !listening) return;
      overlayDepth += 1;
      hist().pushState(overlayState(), "", currentUrl(loc()));
    },

    interceptOverlayPop(): boolean {
      if (!deps.isWeb || !listening || overlayDepth === 0) return false;
      hist().back();
      return true;
    },

    beforeOverlayCloseAll(_reactDepth: number) {
      if (!deps.isWeb || !listening) return;
      const n = overlayDepth;
      if (n <= 0) return;
      suppressCount += 1;
      overlayDepth = 0;
      hist().go(-n);
    },

    syncTabChange(from: TabId, to: TabId) {
      if (!deps.isWeb || !listening || from === to) return;
      if (suppressCount > 0) {
        const mergedFrom = pendingTabChange?.from ?? from;
        pendingTabChange = mergedFrom === to ? null : { from: mergedFrom, to };
        return;
      }
      applyTabHistory(from, to);
    },
  };
}

export type HistorySync = ReturnType<typeof createHistorySync>;

export type UseHistorySyncOptions = {
  enabled: boolean;
  applyOverlayPop: () => void;
  applyReturnToToday: () => void;
};

export function useHistorySync(options: UseHistorySyncOptions): HistorySync {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const syncRef = useRef<HistorySync | null>(null);
  if (syncRef.current === null) {
    syncRef.current = createHistorySync({
      isWeb: Platform.OS === "web",
      applyOverlayPop: () => optionsRef.current.applyOverlayPop(),
      applyReturnToToday: () => optionsRef.current.applyReturnToToday(),
    });
  }

  useEffect(() => {
    const sync = syncRef.current!;
    if (!options.enabled || Platform.OS !== "web") {
      sync.stop();
      return;
    }
    sync.start();
    return () => {
      sync.stop();
    };
  }, [options.enabled]);

  return syncRef.current;
}
