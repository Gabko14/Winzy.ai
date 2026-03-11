import { renderHook, act } from "@testing-library/react-native";
import { Dimensions } from "react-native";

// Mock Dimensions
const mockGet = jest.spyOn(Dimensions, "get");

// Store the dimension change listener
let dimensionListener: ((args: { window: { width: number; height: number } }) => void) | null = null;

jest.spyOn(Dimensions, "addEventListener").mockImplementation((_event, handler) => {
  dimensionListener = handler as (args: { window: { width: number; height: number } }) => void;
  return { remove: () => { dimensionListener = null; } } as ReturnType<typeof Dimensions.addEventListener>;
});

import { useResponsive, breakpoints } from "../useResponsive";

beforeEach(() => {
  dimensionListener = null;
});

describe("useResponsive", () => {
  it("returns sm for phone-width screens", () => {
    mockGet.mockReturnValue({ width: 375, height: 812 } as ReturnType<typeof Dimensions.get>);

    const { result } = renderHook(() => useResponsive());

    expect(result.current.breakpoint).toBe("sm");
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(false);
  });

  it("returns md for tablet-width screens", () => {
    mockGet.mockReturnValue({ width: 768, height: 1024 } as ReturnType<typeof Dimensions.get>);

    const { result } = renderHook(() => useResponsive());

    expect(result.current.breakpoint).toBe("md");
    expect(result.current.isTablet).toBe(true);
  });

  it("returns lg for desktop-width screens", () => {
    mockGet.mockReturnValue({ width: 1200, height: 900 } as ReturnType<typeof Dimensions.get>);

    const { result } = renderHook(() => useResponsive());

    expect(result.current.breakpoint).toBe("lg");
    expect(result.current.isDesktop).toBe(true);
  });

  it("updates on dimension change", () => {
    mockGet.mockReturnValue({ width: 375, height: 812 } as ReturnType<typeof Dimensions.get>);

    const { result } = renderHook(() => useResponsive());
    expect(result.current.breakpoint).toBe("sm");

    act(() => {
      dimensionListener?.({ window: { width: 1024, height: 768 } });
    });

    expect(result.current.breakpoint).toBe("lg");
    expect(result.current.isDesktop).toBe(true);
  });

  it("handles exact breakpoint boundaries", () => {
    // Exactly at md breakpoint
    mockGet.mockReturnValue({ width: breakpoints.md, height: 800 } as ReturnType<typeof Dimensions.get>);
    const { result: mdResult } = renderHook(() => useResponsive());
    expect(mdResult.current.breakpoint).toBe("md");

    // Just below md
    mockGet.mockReturnValue({ width: breakpoints.md - 1, height: 800 } as ReturnType<typeof Dimensions.get>);
    const { result: smResult } = renderHook(() => useResponsive());
    expect(smResult.current.breakpoint).toBe("sm");

    // Exactly at lg breakpoint
    mockGet.mockReturnValue({ width: breakpoints.lg, height: 800 } as ReturnType<typeof Dimensions.get>);
    const { result: lgResult } = renderHook(() => useResponsive());
    expect(lgResult.current.breakpoint).toBe("lg");
  });

  it("returns width value", () => {
    mockGet.mockReturnValue({ width: 414, height: 896 } as ReturnType<typeof Dimensions.get>);

    const { result } = renderHook(() => useResponsive());
    expect(result.current.width).toBe(414);
  });
});
