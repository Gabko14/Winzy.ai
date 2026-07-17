import { createHistorySync, type HistorySyncDeps } from "../useHistorySync";
import type { TabId } from "../TabBar";

type StackEntry = { state: unknown };

function createMockWindow(options?: { asyncGo?: boolean }) {
  const stack: StackEntry[] = [{ state: null }];
  let index = 0;
  const listeners = new Set<(ev: PopStateEvent) => void>();
  let pendingGo: (() => void) | null = null;

  const fire = () => {
    const ev = { state: stack[index].state } as PopStateEvent;
    listeners.forEach((listener) => listener(ev));
  };

  const history: Pick<History, "pushState" | "replaceState" | "back" | "go"> = {
    pushState(state) {
      stack.splice(index + 1);
      stack.push({ state });
      index = stack.length - 1;
    },
    replaceState(state) {
      stack[index] = { state };
    },
    back() {
      history.go(-1);
    },
    go(delta = 0) {
      const next = index + delta;
      if (next < 0 || next >= stack.length) return;
      index = next;
      if (options?.asyncGo) {
        pendingGo = fire;
        return;
      }
      fire();
    },
  };

  return {
    stack,
    get index() {
      return index;
    },
    history,
    location: { pathname: "/", search: "", hash: "" },
    addEventListener(_type: "popstate", listener: (ev: PopStateEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "popstate", listener: (ev: PopStateEvent) => void) {
      listeners.delete(listener);
    },
    flushGo() {
      const fn = pendingGo;
      pendingGo = null;
      fn?.();
    },
  };
}

function createTestSync(
  overrides?: Partial<HistorySyncDeps> & {
    mock?: ReturnType<typeof createMockWindow>;
    asyncGo?: boolean;
  },
) {
  const mock = overrides?.mock ?? createMockWindow({ asyncGo: overrides?.asyncGo });
  const pops: string[] = [];
  const returnsToToday: string[] = [];

  const sync = createHistorySync({
    isWeb: true,
    applyOverlayPop: () => pops.push("pop"),
    applyReturnToToday: () => returnsToToday.push("today"),
    history: mock.history,
    location: mock.location,
    addEventListener: mock.addEventListener,
    removeEventListener: mock.removeEventListener,
    ...overrides,
  });

  return { sync, mock, pops, returnsToToday };
}

describe("createHistorySync", () => {
  describe("refresh re-init", () => {
    it("replaceState to a clean base entry and resets counters on start", () => {
      const { sync, mock } = createTestSync();

      sync.start();
      sync.onOverlayPushed();
      sync.onOverlayPushed();
      sync.syncTabChange("today", "friends");

      expect(sync.overlayDepth).toBe(2);
      expect(sync.hasTabSentinel).toBe(true);
      expect(mock.stack.length).toBeGreaterThan(1);

      sync.start();

      expect(sync.overlayDepth).toBe(0);
      expect(sync.hasTabSentinel).toBe(false);
      expect(sync.suppressCount).toBe(0);
      expect(mock.stack[mock.index].state).toEqual({ __winzy: 1, k: "base" });
    });

    it("stop removes the popstate listener", () => {
      const { sync, mock, pops } = createTestSync();
      sync.start();
      sync.onOverlayPushed();
      sync.stop();

      mock.history.back();
      expect(pops).toEqual([]);
      expect(sync.listening).toBe(false);
    });
  });

  describe("suppress-counter", () => {
    it("ignores the single programmatic popstate from history.go(-n)", () => {
      const { sync, pops, returnsToToday } = createTestSync();
      sync.start();
      sync.onOverlayPushed();
      sync.onOverlayPushed();

      sync.beforeOverlayCloseAll(2);

      expect(sync.suppressCount).toBe(0);
      expect(sync.overlayDepth).toBe(0);
      expect(pops).toEqual([]);
      expect(returnsToToday).toEqual([]);
    });

    it("still handles a real user back after suppress drains", () => {
      const { sync, mock, pops, returnsToToday } = createTestSync();
      sync.start();
      sync.syncTabChange("today", "friends");
      sync.onOverlayPushed();
      sync.onOverlayPushed();

      sync.beforeOverlayCloseAll(2);
      expect(pops).toEqual([]);

      mock.history.back();
      expect(returnsToToday).toEqual(["today"]);
      expect(sync.hasTabSentinel).toBe(false);
    });
  });

  describe("closeAll unwind", () => {
    it("history.go(-depth) with suppress so React closeAll is the only state apply", () => {
      const { sync, mock, pops } = createTestSync();
      sync.start();
      sync.onOverlayPushed();
      sync.onOverlayPushed();
      sync.onOverlayPushed();

      const depthBefore = sync.overlayDepth;
      expect(depthBefore).toBe(3);
      const indexBefore = mock.index;

      sync.beforeOverlayCloseAll(3);

      expect(mock.index).toBe(indexBefore - 3);
      expect(sync.overlayDepth).toBe(0);
      expect(pops).toEqual([]);
    });

    it("defers tab sentinel sync until suppress drains", () => {
      const { sync, mock } = createTestSync({ asyncGo: true });
      sync.start();
      sync.onOverlayPushed();
      sync.onOverlayPushed();

      sync.beforeOverlayCloseAll(2);
      expect(sync.suppressCount).toBe(1);

      sync.syncTabChange("today" as TabId, "friends" as TabId);
      expect(sync.hasTabSentinel).toBe(false);

      mock.flushGo();

      expect(sync.suppressCount).toBe(0);
      expect(sync.hasTabSentinel).toBe(true);
      expect(mock.stack[mock.index].state).toEqual({ __winzy: 1, k: "tab" });
    });

    it("merges rapid tab switches during suppress so the today-departure sentinel is kept", () => {
      const { sync, mock } = createTestSync({ asyncGo: true });
      sync.start();
      sync.onOverlayPushed();

      const replaceSpy = jest.spyOn(mock.history, "replaceState");
      const pushSpy = jest.spyOn(mock.history, "pushState");

      sync.beforeOverlayCloseAll(1);
      expect(sync.suppressCount).toBe(1);

      sync.syncTabChange("today" as TabId, "friends" as TabId);
      sync.syncTabChange("friends" as TabId, "feed" as TabId);

      mock.flushGo();

      expect(sync.hasTabSentinel).toBe(true);
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy).toHaveBeenCalledWith(
        { __winzy: 1, k: "tab" },
        "",
        "/",
      );
      const baseClobbered = replaceSpy.mock.calls.some(
        ([state]) => state && typeof state === "object" && (state as { k?: string }).k === "tab",
      );
      expect(baseClobbered).toBe(false);
      expect(mock.stack[mock.index].state).toEqual({ __winzy: 1, k: "tab" });
      expect(mock.stack[0].state).toEqual({ __winzy: 1, k: "base" });
    });
  });

  describe("overlay + tab model", () => {
    it("UI pop goes through history.back and popstate applies once", () => {
      const { sync, pops } = createTestSync();
      sync.start();
      sync.onOverlayPushed();

      const intercepted = sync.interceptOverlayPop();
      expect(intercepted).toBe(true);
      expect(pops).toEqual(["pop"]);
      expect(sync.overlayDepth).toBe(0);
    });

    it("nested overlays close one per back", () => {
      const { sync, mock, pops } = createTestSync();
      sync.start();
      sync.onOverlayPushed();
      sync.onOverlayPushed();

      mock.history.back();
      expect(pops).toEqual(["pop"]);
      expect(sync.overlayDepth).toBe(1);

      mock.history.back();
      expect(pops).toEqual(["pop", "pop"]);
      expect(sync.overlayDepth).toBe(0);
    });

    it("wandering tabs keeps a single sentinel; back returns to today", () => {
      const { sync, mock, returnsToToday } = createTestSync();
      sync.start();

      sync.syncTabChange("today", "friends");
      sync.syncTabChange("friends", "feed");
      sync.syncTabChange("feed", "profile");

      expect(sync.hasTabSentinel).toBe(true);
      const entriesAfterBase = mock.stack.length - 1;
      expect(entriesAfterBase).toBe(1);

      mock.history.back();
      expect(returnsToToday).toEqual(["today"]);
      expect(sync.hasTabSentinel).toBe(false);
    });

    it("no-ops when isWeb is false", () => {
      const { sync, mock } = createTestSync({ isWeb: false });
      sync.start();
      sync.onOverlayPushed();
      expect(sync.listening).toBe(false);
      expect(mock.stack.length).toBe(1);
      expect(sync.interceptOverlayPop()).toBe(false);
    });
  });
});
