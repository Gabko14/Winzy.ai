import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AnimatedCheckmark } from "../components/AnimatedCheckmark";
import { useReducedMotion } from "../hooks/useReducedMotion";

jest.mock("../hooks/useReducedMotion", () => ({
  useReducedMotion: jest.fn(() => false),
}));

const mockUseReducedMotion = useReducedMotion as jest.Mock;

describe("AnimatedCheckmark", () => {
  it("renders when visible", () => {
    render(<AnimatedCheckmark visible={true} />);
    expect(screen.getByTestId("animated-checkmark")).toBeTruthy();
  });

  it("renders when not visible (hidden via opacity)", () => {
    render(<AnimatedCheckmark visible={false} />);
    expect(screen.getByTestId("animated-checkmark")).toBeTruthy();
  });

  it("has correct accessibility role and label", () => {
    render(<AnimatedCheckmark visible={true} />);
    const checkmark = screen.getByTestId("animated-checkmark");
    expect(checkmark.props.accessibilityRole).toBe("image");
    expect(checkmark.props.accessibilityLabel).toBe("Completed");
  });

  it("accepts custom size", () => {
    render(<AnimatedCheckmark visible={true} size={48} />);
    const checkmark = screen.getByTestId("animated-checkmark");
    expect(checkmark.props.style).toEqual(
      expect.objectContaining({ width: 48, height: 48, borderRadius: 24 }),
    );
  });

  it("accepts custom color", () => {
    render(<AnimatedCheckmark visible={true} color="#FF0000" />);
    const checkmark = screen.getByTestId("animated-checkmark");
    expect(checkmark.props.style).toEqual(
      expect.objectContaining({ backgroundColor: "#FF0000" }),
    );
  });

  it("uses success color by default", () => {
    render(<AnimatedCheckmark visible={true} />);
    const checkmark = screen.getByTestId("animated-checkmark");
    // lightTheme.success = "#16A34A"
    expect(checkmark.props.style).toEqual(
      expect.objectContaining({ backgroundColor: "#16A34A" }),
    );
  });

  it("renders immediately when reduced motion is enabled", () => {
    mockUseReducedMotion.mockReturnValue(true);

    render(<AnimatedCheckmark visible={true} />);
    expect(screen.getByTestId("animated-checkmark")).toBeTruthy();

    mockUseReducedMotion.mockReturnValue(false);
  });
});
