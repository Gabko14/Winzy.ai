import React from "react";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { ShakeView } from "../components/ShakeView";
import { useReducedMotion } from "../hooks/useReducedMotion";

jest.mock("../hooks/useReducedMotion", () => ({
  useReducedMotion: jest.fn(() => false),
}));

const mockUseReducedMotion = useReducedMotion as jest.Mock;

describe("ShakeView", () => {
  it("renders children", () => {
    render(
      <ShakeView shake={false}>
        <Text>Error content</Text>
      </ShakeView>,
    );
    expect(screen.getByText("Error content")).toBeTruthy();
  });

  it("renders with testID", () => {
    render(
      <ShakeView shake={false}>
        <Text>Content</Text>
      </ShakeView>,
    );
    expect(screen.getByTestId("shake-view")).toBeTruthy();
  });

  it("renders when shake is true", () => {
    render(
      <ShakeView shake={true}>
        <Text>Shaking</Text>
      </ShakeView>,
    );
    expect(screen.getByText("Shaking")).toBeTruthy();
  });

  it("accepts custom intensity and duration", () => {
    render(
      <ShakeView shake={true} intensity={10} duration={600}>
        <Text>Custom shake</Text>
      </ShakeView>,
    );
    expect(screen.getByText("Custom shake")).toBeTruthy();
  });

  it("does not animate when reduced motion is enabled", () => {
    mockUseReducedMotion.mockReturnValue(true);

    render(
      <ShakeView shake={true}>
        <Text>No shake</Text>
      </ShakeView>,
    );
    expect(screen.getByText("No shake")).toBeTruthy();

    mockUseReducedMotion.mockReturnValue(false);
  });
});
