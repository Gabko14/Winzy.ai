import { renderHook, act } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import { useReducedMotion } from "../hooks/useReducedMotion";

// Save original Platform.OS so we can restore it
const originalPlatform = Platform.OS;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  Object.defineProperty(Platform, "OS", { value: originalPlatform, writable: true });
  process.env.NODE_ENV = originalNodeEnv;
  jest.restoreAllMocks();
});

describe("useReducedMotion", () => {
  it("returns true immediately in test environment", () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  describe("native (iOS/Android)", () => {
    beforeEach(() => {
      // Override NODE_ENV so the hook exercises the real runtime path
      process.env.NODE_ENV = "development";
      Object.defineProperty(Platform, "OS", { value: "ios", writable: true });
    });

    it("returns false by default", () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
      jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(false);
    });

    it("returns true when reduce motion is enabled", async () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
      jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

      const { result } = renderHook(() => useReducedMotion());

      // Wait for the async check
      await act(async () => {});
      expect(result.current).toBe(true);
    });

    it("listens for accessibility changes", () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
      const addSpy = jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

      renderHook(() => useReducedMotion());
      expect(addSpy).toHaveBeenCalledWith("reduceMotionChanged", expect.any(Function));
    });

    it("removes listener on unmount", () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
      const removeFn = jest.fn();
      jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: removeFn } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

      const { unmount } = renderHook(() => useReducedMotion());
      unmount();
      expect(removeFn).toHaveBeenCalled();
    });
  });
});
