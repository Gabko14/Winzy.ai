import { renderHook, act } from "@testing-library/react-native";
import { useOnboarding, _resetOnboardingStorage } from "../useOnboarding";

beforeEach(() => {
  _resetOnboardingStorage();
});

describe("useOnboarding", () => {
  // --- Happy path ---

  it("starts with loading true and flags false for new users", async () => {
    const { result } = renderHook(() => useOnboarding("user-1"));

    expect(result.current.loading).toBe(true);

    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.hasSeenWelcome).toBe(false);
    expect(result.current.hasSeenFlameIntro).toBe(false);
  });

  it("markWelcomeSeen updates state immediately", async () => {
    const { result } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
    });

    expect(result.current.hasSeenWelcome).toBe(true);
    expect(result.current.hasSeenFlameIntro).toBe(false);
  });

  it("markFlameIntroSeen updates state immediately", async () => {
    const { result } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    act(() => {
      result.current.markFlameIntroSeen();
    });

    expect(result.current.hasSeenFlameIntro).toBe(true);
    expect(result.current.hasSeenWelcome).toBe(false);
  });

  // --- Edge cases ---

  it("persists welcome flag across hook remounts", async () => {
    const { result, unmount } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
    });
    expect(result.current.hasSeenWelcome).toBe(true);

    unmount();

    const { result: result2 } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    expect(result2.current.hasSeenWelcome).toBe(true);
  });

  it("persists flame intro flag across hook remounts", async () => {
    const { result, unmount } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    act(() => {
      result.current.markFlameIntroSeen();
    });
    unmount();

    const { result: result2 } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    expect(result2.current.hasSeenFlameIntro).toBe(true);
  });

  it("both flags can be set independently", async () => {
    const { result } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
    });
    expect(result.current.hasSeenWelcome).toBe(true);
    expect(result.current.hasSeenFlameIntro).toBe(false);

    act(() => {
      result.current.markFlameIntroSeen();
    });
    expect(result.current.hasSeenWelcome).toBe(true);
    expect(result.current.hasSeenFlameIntro).toBe(true);
  });

  it("calling markWelcomeSeen multiple times is idempotent", async () => {
    const { result } = renderHook(() => useOnboarding("user-1"));
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
      result.current.markWelcomeSeen();
      result.current.markWelcomeSeen();
    });

    expect(result.current.hasSeenWelcome).toBe(true);
  });

  // --- Multi-user browser behavior (shared-browser leak fix) ---

  it("User A completing onboarding does not affect User B", async () => {
    // User A completes onboarding
    const { result: userA, unmount: unmountA } = renderHook(() => useOnboarding("user-a"));
    await act(async () => {});

    act(() => {
      userA.current.markWelcomeSeen();
      userA.current.markFlameIntroSeen();
    });
    expect(userA.current.hasSeenWelcome).toBe(true);
    expect(userA.current.hasSeenFlameIntro).toBe(true);
    unmountA();

    // User B logs in on the same browser — should see onboarding
    const { result: userB } = renderHook(() => useOnboarding("user-b"));
    await act(async () => {});

    expect(userB.current.hasSeenWelcome).toBe(false);
    expect(userB.current.hasSeenFlameIntro).toBe(false);
  });

  it("User B completing welcome does not affect User A flame intro", async () => {
    // User A sees welcome only
    const { result: userA, unmount: unmountA } = renderHook(() => useOnboarding("user-a"));
    await act(async () => {});
    act(() => {
      userA.current.markWelcomeSeen();
    });
    unmountA();

    // User B completes both
    const { result: userB, unmount: unmountB } = renderHook(() => useOnboarding("user-b"));
    await act(async () => {});
    act(() => {
      userB.current.markWelcomeSeen();
      userB.current.markFlameIntroSeen();
    });
    unmountB();

    // User A comes back — should still need flame intro
    const { result: userA2 } = renderHook(() => useOnboarding("user-a"));
    await act(async () => {});

    expect(userA2.current.hasSeenWelcome).toBe(true);
    expect(userA2.current.hasSeenFlameIntro).toBe(false);
  });

  it("same user on remount retains completed onboarding", async () => {
    const { result, unmount } = renderHook(() => useOnboarding("user-x"));
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
      result.current.markFlameIntroSeen();
    });
    unmount();

    // Same user comes back
    const { result: result2 } = renderHook(() => useOnboarding("user-x"));
    await act(async () => {});

    expect(result2.current.hasSeenWelcome).toBe(true);
    expect(result2.current.hasSeenFlameIntro).toBe(true);
  });

  it("switching userId resets state and reloads from storage", async () => {
    // Start as user-a, complete onboarding
    let userId = "user-a";
    const { result, rerender } = renderHook(() => useOnboarding(userId));
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
      result.current.markFlameIntroSeen();
    });
    expect(result.current.hasSeenWelcome).toBe(true);
    expect(result.current.hasSeenFlameIntro).toBe(true);

    // Switch to user-b without unmounting (simulates logout+login in same session)
    userId = "user-b";
    rerender(undefined);

    // State should reset to loading while reading new user's storage
    expect(result.current.loading).toBe(true);
    expect(result.current.hasSeenWelcome).toBe(false);
    expect(result.current.hasSeenFlameIntro).toBe(false);

    await act(async () => {});

    // user-b has never completed onboarding
    expect(result.current.loading).toBe(false);
    expect(result.current.hasSeenWelcome).toBe(false);
    expect(result.current.hasSeenFlameIntro).toBe(false);
  });

  // --- Error conditions ---

  it("empty userId still works without crashing", async () => {
    const { result } = renderHook(() => useOnboarding(""));
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.hasSeenWelcome).toBe(false);

    act(() => {
      result.current.markWelcomeSeen();
    });
    expect(result.current.hasSeenWelcome).toBe(true);
  });
});
