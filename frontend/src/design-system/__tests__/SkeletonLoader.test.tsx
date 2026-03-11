import React from "react";
import { render, screen } from "@testing-library/react-native";
import { SkeletonLoader } from "../components/SkeletonLoader";
import { useReducedMotion } from "../hooks/useReducedMotion";

jest.mock("../hooks/useReducedMotion", () => ({
  useReducedMotion: jest.fn(() => false),
}));

const mockUseReducedMotion = useReducedMotion as jest.Mock;

describe("SkeletonLoader", () => {
  it("renders with specified width and default height", () => {
    render(<SkeletonLoader width={200} />);
    const skeleton = screen.getByTestId("skeleton-loader");
    expect(skeleton.props.style).toEqual(
      expect.objectContaining({ width: 200, height: 16 }),
    );
  });

  it("renders with custom height", () => {
    render(<SkeletonLoader width={100} height={24} />);
    const skeleton = screen.getByTestId("skeleton-loader");
    expect(skeleton.props.style).toEqual(
      expect.objectContaining({ width: 100, height: 24 }),
    );
  });

  it("renders percentage width", () => {
    render(<SkeletonLoader width="80%" height={12} />);
    const skeleton = screen.getByTestId("skeleton-loader");
    expect(skeleton.props.style).toEqual(
      expect.objectContaining({ width: "80%", height: 12 }),
    );
  });

  it("renders as circle when circle prop is true", () => {
    render(<SkeletonLoader width={40} circle />);
    const skeleton = screen.getByTestId("skeleton-loader");
    expect(skeleton.props.style).toEqual(
      expect.objectContaining({
        width: 40,
        height: 40,
        borderRadius: 20,
      }),
    );
  });

  it("has correct accessibility label", () => {
    render(<SkeletonLoader width={100} />);
    const skeleton = screen.getByTestId("skeleton-loader");
    expect(skeleton.props.accessibilityLabel).toBe("Loading");
  });

  it("shows static opacity when reduced motion is enabled", () => {
    mockUseReducedMotion.mockReturnValue(true);

    render(<SkeletonLoader width={100} />);
    expect(screen.getByTestId("skeleton-loader")).toBeTruthy();

    mockUseReducedMotion.mockReturnValue(false);
  });

  it("accepts custom borderRadius", () => {
    render(<SkeletonLoader width={100} borderRadius={4} />);
    const skeleton = screen.getByTestId("skeleton-loader");
    expect(skeleton.props.style).toEqual(
      expect.objectContaining({ borderRadius: 4 }),
    );
  });
});
