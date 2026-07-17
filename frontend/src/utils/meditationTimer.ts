/** Absolute-timestamp meditation session math. Intervals only repaint — never the source of truth. */

export const MEDITATION_PRESETS_MIN = [5, 10, 15, 20] as const;
export const MEDITATION_MIN_MINUTES = 1;
export const MEDITATION_MAX_MINUTES = 120;

export type MeditationPhase = "setup" | "running" | "paused" | "completed";

export type MeditationSessionState = {
  phase: MeditationPhase;
  /** Total planned duration in ms. */
  durationMs: number;
  /** Absolute end time while running; null when paused/setup/completed. */
  endsAt: number | null;
  /** Remaining ms captured on pause (and used to resume). */
  remainingMs: number;
  /** Elapsed ms at completion (for display). */
  completedMs: number;
};

export function clampDurationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return MEDITATION_MIN_MINUTES;
  return Math.min(
    MEDITATION_MAX_MINUTES,
    Math.max(MEDITATION_MIN_MINUTES, Math.round(minutes)),
  );
}

export function minutesToMs(minutes: number): number {
  return clampDurationMinutes(minutes) * 60_000;
}

export function createSetupState(durationMinutes: number): MeditationSessionState {
  const durationMs = minutesToMs(durationMinutes);
  return {
    phase: "setup",
    durationMs,
    endsAt: null,
    remainingMs: durationMs,
    completedMs: 0,
  };
}

export function startSession(
  state: MeditationSessionState,
  nowMs: number = Date.now(),
): MeditationSessionState {
  const remainingMs = state.remainingMs > 0 ? state.remainingMs : state.durationMs;
  return {
    ...state,
    phase: "running",
    remainingMs,
    endsAt: nowMs + remainingMs,
    completedMs: 0,
  };
}

export function pauseSession(
  state: MeditationSessionState,
  nowMs: number = Date.now(),
): MeditationSessionState {
  if (state.phase !== "running" || state.endsAt == null) return state;
  const remainingMs = Math.max(0, state.endsAt - nowMs);
  if (remainingMs <= 0) {
    return completeSession(state, nowMs);
  }
  return {
    ...state,
    phase: "paused",
    endsAt: null,
    remainingMs,
  };
}

export function resumeSession(
  state: MeditationSessionState,
  nowMs: number = Date.now(),
): MeditationSessionState {
  if (state.phase !== "paused") return state;
  return {
    ...state,
    phase: "running",
    endsAt: nowMs + state.remainingMs,
  };
}

export function completeSession(
  state: MeditationSessionState,
  nowMs: number = Date.now(),
): MeditationSessionState {
  const elapsed =
    state.phase === "running" && state.endsAt != null
      ? Math.min(state.durationMs, state.durationMs - Math.max(0, state.endsAt - nowMs))
      : state.durationMs - state.remainingMs;
  return {
    ...state,
    phase: "completed",
    endsAt: null,
    remainingMs: 0,
    completedMs: Math.max(0, Math.min(state.durationMs, Math.round(elapsed))),
  };
}

/** Remaining ms derived from absolute endsAt (running) or stored remaining (paused). */
export function remainingMsAt(
  state: MeditationSessionState,
  nowMs: number = Date.now(),
): number {
  if (state.phase === "completed" || state.phase === "setup") {
    return state.phase === "setup" ? state.remainingMs : 0;
  }
  if (state.phase === "paused") {
    return state.remainingMs;
  }
  if (state.endsAt == null) return state.remainingMs;
  return Math.max(0, state.endsAt - nowMs);
}

/** Re-sync on visibility / tick. May jump to completed if endsAt passed. */
export function syncSession(
  state: MeditationSessionState,
  nowMs: number = Date.now(),
): MeditationSessionState {
  if (state.phase !== "running" || state.endsAt == null) return state;
  if (nowMs >= state.endsAt) {
    return completeSession(state, nowMs);
  }
  return state;
}

export function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Whole minutes for completion copy ("12 minutes of calm"). Rounds to nearest minute, min 1 if any time. */
export function completedMinutesLabel(completedMs: number): number {
  if (completedMs <= 0) return 0;
  const mins = Math.round(completedMs / 60_000);
  return Math.max(1, mins);
}
