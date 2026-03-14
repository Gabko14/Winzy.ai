import { renderHook, act } from "@testing-library/react-native";
import { useOnboarding, _resetOnboardingStorage } from "../useOnboarding";

beforeEach(() => {
  _resetOnboardingStorage();
});

describe("useOnboarding", () => {
  // --- Happy path ---

  it("starts with loading true and flags false for new users", async () => {
    const { result } = renderHook(() => useOnboarding());

    // Initially loading
    expect(result.current.loading).toBe(true);

    // After async storage read completes
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.hasSeenWelcome).toBe(false);
    expect(result.current.hasSeenFlameIntro).toBe(false);
  });

  it("markWelcomeSeen updates state immediately", async () => {
    const { result } = renderHook(() => useOnboarding());
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
    });

    expect(result.current.hasSeenWelcome).toBe(true);
    expect(result.current.hasSeenFlameIntro).toBe(false);
  });

  it("markFlameIntroSeen updates state immediately", async () => {
    const { result } = renderHook(() => useOnboarding());
    await act(async () => {});

    act(() => {
      result.current.markFlameIntroSeen();
    });

    expect(result.current.hasSeenFlameIntro).toBe(true);
    expect(result.current.hasSeenWelcome).toBe(false);
  });

  // --- Edge cases ---

  it("persists welcome flag across hook remounts", async () => {
    const { result, unmount } = renderHook(() => useOnboarding());
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
    });
    expect(result.current.hasSeenWelcome).toBe(true);

    unmount();

    // Re-mount the hook — should read persisted value
    const { result: result2 } = renderHook(() => useOnboarding());
    await act(async () => {});

    expect(result2.current.hasSeenWelcome).toBe(true);
  });

  it("persists flame intro flag across hook remounts", async () => {
    const { result, unmount } = renderHook(() => useOnboarding());
    await act(async () => {});

    act(() => {
      result.current.markFlameIntroSeen();
    });
    unmount();

    const { result: result2 } = renderHook(() => useOnboarding());
    await act(async () => {});

    expect(result2.current.hasSeenFlameIntro).toBe(true);
  });

  it("both flags can be set independently", async () => {
    const { result } = renderHook(() => useOnboarding());
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
    const { result } = renderHook(() => useOnboarding());
    await act(async () => {});

    act(() => {
      result.current.markWelcomeSeen();
      result.current.markWelcomeSeen();
      result.current.markWelcomeSeen();
    });

    expect(result.current.hasSeenWelcome).toBe(true);
  });
});
