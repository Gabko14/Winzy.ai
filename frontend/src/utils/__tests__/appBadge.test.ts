import { QueryClient } from "@tanstack/react-query";
import type { CompletionsRangeResponse } from "../../api/habits";
import { queryKeys } from "../../api/queryKeys";
import {
  applyAppBadge,
  countDueIncompleteHabits,
  syncAppBadgeFromCache,
} from "../appBadge";

describe("countDueIncompleteHabits", () => {
  const today = "2026-07-17"; // Friday

  const habits = [
    { id: "daily-1", frequency: "daily" as const, customDays: null },
    { id: "weekly-fri", frequency: "weekly" as const, customDays: [5] },
    { id: "weekly-mon", frequency: "weekly" as const, customDays: [1] },
    { id: "done-daily", frequency: "daily" as const, customDays: null },
  ];

  function rangeWith(
    entries: Array<{ id: string; completed: boolean }>,
  ): CompletionsRangeResponse {
    return {
      from: "2026-07-11",
      to: today,
      habits: entries.map((e) => ({
        id: e.id,
        name: e.id,
        icon: null,
        color: null,
        frequency: "daily" as const,
        customDays: null,
        minimumDescription: null,
        days: [
          {
            date: today,
            completed: e.completed,
            completionKind: e.completed ? ("full" as const) : null,
          },
        ],
      })),
    };
  }

  it("counts due incomplete habits and skips not-due / completed", () => {
    const range = rangeWith([
      { id: "daily-1", completed: false },
      { id: "weekly-fri", completed: false },
      { id: "weekly-mon", completed: false },
      { id: "done-daily", completed: true },
    ]);
    // daily-1 + weekly-fri due and incomplete; weekly-mon not due Fri; done-daily completed
    expect(countDueIncompleteHabits(habits, range, today)).toBe(2);
  });

  it("treats missing range entries as incomplete", () => {
    expect(countDueIncompleteHabits(habits, undefined, today)).toBe(3);
    expect(countDueIncompleteHabits(habits, { from: today, to: today, habits: [] }, today)).toBe(
      3,
    );
  });

  it("returns 0 when all due habits are completed", () => {
    const range = rangeWith([
      { id: "daily-1", completed: true },
      { id: "weekly-fri", completed: true },
      { id: "done-daily", completed: true },
    ]);
    expect(countDueIncompleteHabits(habits, range, today)).toBe(0);
  });

  it("rolls with injected today (timezone day boundary)", () => {
    // Saturday — weekly-fri no longer due
    const saturday = "2026-07-18";
    expect(countDueIncompleteHabits(habits, undefined, saturday)).toBe(2);
  });
});

describe("applyAppBadge", () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it("no-ops when Badging API is missing", async () => {
    Object.defineProperty(global, "navigator", {
      value: {},
      configurable: true,
      writable: true,
    });
    await expect(applyAppBadge(3)).resolves.toBeUndefined();
  });

  it("calls setAppBadge for positive counts", async () => {
    const setAppBadge = jest.fn().mockResolvedValue(undefined);
    const clearAppBadge = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, "navigator", {
      value: { setAppBadge, clearAppBadge },
      configurable: true,
      writable: true,
    });
    await applyAppBadge(2);
    expect(setAppBadge).toHaveBeenCalledWith(2);
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it("calls clearAppBadge when count is 0", async () => {
    const setAppBadge = jest.fn().mockResolvedValue(undefined);
    const clearAppBadge = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, "navigator", {
      value: { setAppBadge, clearAppBadge },
      configurable: true,
      writable: true,
    });
    await applyAppBadge(0);
    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it("swallows Badging API errors", async () => {
    Object.defineProperty(global, "navigator", {
      value: {
        setAppBadge: jest.fn().mockRejectedValue(new Error("denied")),
      },
      configurable: true,
      writable: true,
    });
    await expect(applyAppBadge(1)).resolves.toBeUndefined();
  });
});

describe("syncAppBadgeFromCache", () => {
  it("no-ops when habits are not cached yet", async () => {
    const setAppBadge = jest.fn();
    Object.defineProperty(global, "navigator", {
      value: { setAppBadge, clearAppBadge: jest.fn() },
      configurable: true,
      writable: true,
    });
    const client = new QueryClient();
    await syncAppBadgeFromCache(client, "2026-07-17");
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it("applies count from cached habits + range", async () => {
    const setAppBadge = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, "navigator", {
      value: { setAppBadge, clearAppBadge: jest.fn() },
      configurable: true,
      writable: true,
    });
    const client = new QueryClient();
    const today = "2026-07-17";
    client.setQueryData(queryKeys.habits.list(), [
      { id: "h1", frequency: "daily", customDays: null },
      { id: "h2", frequency: "daily", customDays: null },
    ]);
    client.setQueryData(queryKeys.completions.range("2026-07-11", today), {
      from: "2026-07-11",
      to: today,
      habits: [
        {
          id: "h1",
          name: "h1",
          icon: null,
          color: null,
          frequency: "daily" as const,
          customDays: null,
          minimumDescription: null,
          days: [{ date: today, completed: true, completionKind: "full" }],
        },
        {
          id: "h2",
          name: "h2",
          icon: null,
          color: null,
          frequency: "daily" as const,
          customDays: null,
          minimumDescription: null,
          days: [{ date: today, completed: false, completionKind: null }],
        },
      ],
    });
    await syncAppBadgeFromCache(client, today);
    expect(setAppBadge).toHaveBeenCalledWith(1);
  });
});
