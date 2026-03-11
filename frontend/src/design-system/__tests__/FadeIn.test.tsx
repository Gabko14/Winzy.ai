import React from "react";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { FadeIn } from "../components/FadeIn";
import { useReducedMotion } from "../hooks/useReducedMotion";

jest.mock("../hooks/useReducedMotion", () => ({
  useReducedMotion: jest.fn(() => false),
}));

const mockUseReducedMotion = useReducedMotion as jest.Mock;

describe("FadeIn", () => {
  it("renders children", () => {
    render(
      <FadeIn>
        <Text>Hello</Text>
      </FadeIn>,
    );
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("renders with testID", () => {
    render(
      <FadeIn>
        <Text>Content</Text>
      </FadeIn>,
    );
    expect(screen.getByTestId("fade-in")).toBeTruthy();
  });

  it("accepts custom delay and duration", () => {
    render(
      <FadeIn delay={100} duration={300}>
        <Text>Delayed</Text>
      </FadeIn>,
    );
    expect(screen.getByText("Delayed")).toBeTruthy();
  });

  it("renders immediately when reduced motion is enabled", () => {
    mockUseReducedMotion.mockReturnValue(true);

    render(
      <FadeIn>
        <Text>Instant</Text>
      </FadeIn>,
    );
    expect(screen.getByText("Instant")).toBeTruthy();

    mockUseReducedMotion.mockReturnValue(false);
  });
});
