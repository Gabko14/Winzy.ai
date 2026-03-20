import { renderHook, act } from "@testing-library/react-native";
import { useOverlayRouter } from "../useOverlayRouter";

describe("useOverlayRouter", () => {
  // --- Happy path ---

  it("starts with no overlay", () => {
    const { result } = renderHook(() => useOverlayRouter());
    expect(result.current.current).toBeNull();
    expect(result.current.params).toEqual({});
  });

  it("pushes an overlay screen", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.push("editProfile");
    });

    expect(result.current.current).toBe("editProfile");
    expect(result.current.params).toEqual({});
  });

  it("pushes an overlay with params", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.push("habitDetail", { habitId: "h1" });
    });

    expect(result.current.current).toBe("habitDetail");
    expect(result.current.params).toEqual({ habitId: "h1" });
  });

  it("pops the top overlay revealing the one below", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.push("friendProfile", { friendId: "f1" });
      result.current.push("createChallenge", { friendId: "f1", friendName: "Alice" });
    });

    expect(result.current.current).toBe("createChallenge");

    act(() => {
      result.current.pop();
    });

    expect(result.current.current).toBe("friendProfile");
    expect(result.current.params).toEqual({ friendId: "f1" });
  });

  it("replaces the top overlay", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.push("habitDetail", { habitId: "h1" });
    });

    act(() => {
      result.current.replace("stats", { habitId: "h1" });
    });

    expect(result.current.current).toBe("stats");
    expect(result.current.params).toEqual({ habitId: "h1" });
  });

  it("closes all overlays", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.push("editProfile");
      result.current.push("notifications");
      result.current.push("habitDetail", { habitId: "h1" });
    });

    expect(result.current.current).toBe("habitDetail");

    act(() => {
      result.current.closeAll();
    });

    expect(result.current.current).toBeNull();
    expect(result.current.params).toEqual({});
  });

  // --- Edge cases ---

  it("pop on empty stack is a no-op", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.pop();
    });

    expect(result.current.current).toBeNull();
  });

  it("closeAll on empty stack is a no-op", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.closeAll();
    });

    expect(result.current.current).toBeNull();
  });

  it("replace on single-item stack replaces the only entry", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.push("editProfile");
    });

    act(() => {
      result.current.replace("settings");
    });

    expect(result.current.current).toBe("settings");

    act(() => {
      result.current.pop();
    });

    expect(result.current.current).toBeNull();
  });

  it("handles deep stack correctly", () => {
    const { result } = renderHook(() => useOverlayRouter());

    act(() => {
      result.current.push("habits");
      result.current.push("habitDetail", { habitId: "h1" });
      result.current.push("editHabit", { editHabitData: { id: "h1" } as never });
    });

    expect(result.current.current).toBe("editHabit");

    act(() => {
      result.current.pop();
    });

    expect(result.current.current).toBe("habitDetail");

    act(() => {
      result.current.pop();
    });

    expect(result.current.current).toBe("habits");
  });
});
