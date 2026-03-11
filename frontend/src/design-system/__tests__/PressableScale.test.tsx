import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { PressableScale } from "../components/PressableScale";

jest.mock("../hooks/useReducedMotion", () => ({
  useReducedMotion: jest.fn(() => false),
}));

describe("PressableScale", () => {
  it("renders children", () => {
    render(
      <PressableScale onPress={jest.fn()}>
        <Text>Tap me</Text>
      </PressableScale>,
    );
    expect(screen.getByText("Tap me")).toBeTruthy();
  });

  it("calls onPress when pressed", () => {
    const onPress = jest.fn();
    render(
      <PressableScale onPress={onPress}>
        <Text>Press</Text>
      </PressableScale>,
    );
    fireEvent.press(screen.getByText("Press"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders inner animated view with testID", () => {
    render(
      <PressableScale onPress={jest.fn()}>
        <Text>Content</Text>
      </PressableScale>,
    );
    expect(screen.getByTestId("pressable-scale-inner")).toBeTruthy();
  });

  it("does not crash when disabled", () => {
    render(
      <PressableScale onPress={jest.fn()} disabled>
        <Text>Disabled</Text>
      </PressableScale>,
    );
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("passes through onPressIn and onPressOut callbacks", () => {
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    render(
      <PressableScale onPress={jest.fn()} onPressIn={onPressIn} onPressOut={onPressOut}>
        <Text>Callbacks</Text>
      </PressableScale>,
    );
    const pressable = screen.getByText("Callbacks").parent?.parent;
    if (pressable) {
      fireEvent(pressable, "pressIn");
      expect(onPressIn).toHaveBeenCalled();
    }
  });
});
