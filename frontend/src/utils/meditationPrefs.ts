import { Platform } from "react-native";
import { clampDurationMinutes } from "./meditationTimer";

export const LAST_DURATION_KEY = "winzy.meditation.lastDurationMin";
export const LAST_LOGGED_HABIT_KEY = "winzy.meditation.lastLoggedHabitId";
export const DEFAULT_DURATION_MIN = 10;

type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const mem = new Map<string, string>();
const memStorage: Storage = {
  getItem: (key) => Promise.resolve(mem.get(key) ?? null),
  setItem: (key, value) => {
    mem.set(key, value);
    return Promise.resolve();
  },
};

export function getMeditationStorage(): Storage {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    return {
      getItem: (key) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key, value) => {
        localStorage.setItem(key, value);
        return Promise.resolve();
      },
    };
  }
  return memStorage;
}

/** @internal Test-only */
export function _resetMeditationStorage(): void {
  mem.clear();
}

export async function loadLastDurationMin(): Promise<number> {
  const raw = await getMeditationStorage().getItem(LAST_DURATION_KEY);
  if (raw == null) return DEFAULT_DURATION_MIN;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DURATION_MIN;
  return clampDurationMinutes(n);
}

export async function saveLastDurationMin(minutes: number): Promise<void> {
  await getMeditationStorage().setItem(
    LAST_DURATION_KEY,
    String(clampDurationMinutes(minutes)),
  );
}

export async function loadLastLoggedHabitId(): Promise<string | null> {
  return getMeditationStorage().getItem(LAST_LOGGED_HABIT_KEY);
}

export async function saveLastLoggedHabitId(habitId: string): Promise<void> {
  await getMeditationStorage().setItem(LAST_LOGGED_HABIT_KEY, habitId);
}
