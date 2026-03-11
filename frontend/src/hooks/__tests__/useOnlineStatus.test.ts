import { renderHook } from "@testing-library/react-native";
import { useOnlineStatus } from "../useOnlineStatus";

// On the test platform (default), Platform.OS is not "web",
// so the hook always returns true on native.

describe("useOnlineStatus", () => {
  it("returns true on non-web platform", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("returns true consistently (native has no offline transitions)", () => {
    const { result, rerender } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    rerender({});
    expect(result.current).toBe(true);
  });
});
