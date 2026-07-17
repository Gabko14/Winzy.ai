import {
  clampDurationMinutes,
  minutesToMs,
  createSetupState,
  startSession,
  pauseSession,
  resumeSession,
  remainingMsAt,
  syncSession,
  formatMmSs,
  completedMinutesLabel,
  MEDITATION_MIN_MINUTES,
  MEDITATION_MAX_MINUTES,
} from "../meditationTimer";

describe("meditationTimer — duration helpers", () => {
  it("clamps to 1–120", () => {
    expect(clampDurationMinutes(0)).toBe(MEDITATION_MIN_MINUTES);
    expect(clampDurationMinutes(200)).toBe(MEDITATION_MAX_MINUTES);
    expect(clampDurationMinutes(7.4)).toBe(7);
    expect(clampDurationMinutes(NaN)).toBe(MEDITATION_MIN_MINUTES);
  });

  it("converts minutes to ms", () => {
    expect(minutesToMs(5)).toBe(5 * 60_000);
  });
});

describe("meditationTimer — absolute endsAt math", () => {
  const t0 = 1_000_000;

  it("start sets endsAt = now + duration", () => {
    const setup = createSetupState(5);
    const running = startSession(setup, t0);
    expect(running.phase).toBe("running");
    expect(running.endsAt).toBe(t0 + 5 * 60_000);
    expect(remainingMsAt(running, t0)).toBe(5 * 60_000);
  });

  it("remaining derives from endsAt, not interval counts", () => {
    const running = startSession(createSetupState(1), t0);
    expect(remainingMsAt(running, t0 + 15_000)).toBe(45_000);
    expect(remainingMsAt(running, t0 + 60_000)).toBe(0);
  });

  it("pause stores remaining and clears endsAt", () => {
    const running = startSession(createSetupState(2), t0);
    const paused = pauseSession(running, t0 + 30_000);
    expect(paused.phase).toBe("paused");
    expect(paused.endsAt).toBeNull();
    expect(paused.remainingMs).toBe(90_000);
    expect(remainingMsAt(paused, t0 + 999_999)).toBe(90_000);
  });

  it("resume re-derives endsAt from remaining", () => {
    const paused = pauseSession(startSession(createSetupState(2), t0), t0 + 30_000);
    const resumeAt = t0 + 100_000;
    const resumed = resumeSession(paused, resumeAt);
    expect(resumed.phase).toBe("running");
    expect(resumed.endsAt).toBe(resumeAt + 90_000);
    expect(remainingMsAt(resumed, resumeAt)).toBe(90_000);
  });

  it("sync jumps to completed when endsAt passed while hidden", () => {
    const running = startSession(createSetupState(1), t0);
    const synced = syncSession(running, t0 + 61_000);
    expect(synced.phase).toBe("completed");
    expect(synced.remainingMs).toBe(0);
    expect(synced.endsAt).toBeNull();
    expect(synced.completedMs).toBe(60_000);
  });

  it("sync leaves running state alone when time remains", () => {
    const running = startSession(createSetupState(1), t0);
    expect(syncSession(running, t0 + 10_000).phase).toBe("running");
  });

  it("pause at exact end completes", () => {
    const running = startSession(createSetupState(1), t0);
    const done = pauseSession(running, t0 + 60_000);
    expect(done.phase).toBe("completed");
  });

  it("formatMmSs ceil-rounds remaining seconds", () => {
    expect(formatMmSs(60_000)).toBe("1:00");
    expect(formatMmSs(59_001)).toBe("1:00");
    expect(formatMmSs(1_000)).toBe("0:01");
    expect(formatMmSs(0)).toBe("0:00");
  });

  it("completedMinutesLabel rounds for copy", () => {
    expect(completedMinutesLabel(0)).toBe(0);
    expect(completedMinutesLabel(30_000)).toBe(1);
    expect(completedMinutesLabel(12 * 60_000)).toBe(12);
  });
});

describe("meditationTimer — fake timers integration", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("hidden-through-end via setInterval tick path still completes from absolute time", () => {
    const t0 = Date.now();
    let state = startSession(createSetupState(1), t0);

    // Simulate a 500ms repaint driver that only syncs
    const id = setInterval(() => {
      state = syncSession(state, Date.now());
    }, 500);

    // Jump past the end (as if tab was throttled / hidden)
    jest.advanceTimersByTime(61_000);
    state = syncSession(state, Date.now());

    expect(state.phase).toBe("completed");
    clearInterval(id);
  });

  it("pause mid-session then resume after wall-clock gap preserves remaining", () => {
    const t0 = Date.now();
    let state = startSession(createSetupState(5), t0);

    jest.advanceTimersByTime(120_000);
    state = pauseSession(state, Date.now());
    expect(state.remainingMs).toBe(3 * 60_000);

    jest.advanceTimersByTime(10 * 60_000);
    state = resumeSession(state, Date.now());
    expect(remainingMsAt(state, Date.now())).toBe(3 * 60_000);

    jest.advanceTimersByTime(3 * 60_000);
    state = syncSession(state, Date.now());
    expect(state.phase).toBe("completed");
  });
});
