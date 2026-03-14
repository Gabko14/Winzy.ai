import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { WelcomeScreen } from "../WelcomeScreen";

// Mock design system components
jest.mock("../../design-system", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require("react-native");
  return {
    Button: ({ title, onPress, accessibilityLabel }: { title: string; onPress: () => void; accessibilityLabel?: string }) => (
      <RN.Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID="welcome-button">
        <RN.Text>{title}</RN.Text>
      </RN.Pressable>
    ),
    Flame: ({ flameLevel, size }: { flameLevel: string; size: string }) => (
      <RN.View testID="welcome-flame">
        <RN.Text>{flameLevel} {size}</RN.Text>
      </RN.View>
    ),
    FadeIn: ({ children }: { children: React.ReactNode }) => <RN.View testID="fade-in">{children}</RN.View>,
    spacing: { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, "2xl": 32, "3xl": 40, "4xl": 48, "5xl": 64 },
    typography: {
      h2: { fontSize: 30, fontWeight: "700" },
      body: { fontSize: 16 },
    },
    lightTheme: {
      background: "#FAFAF9",
      textPrimary: "#1C1917",
      textSecondary: "#57534E",
    },
  };
});

describe("WelcomeScreen", () => {
  // --- Happy path ---

  it("renders welcome screen with title and flame", () => {
    const { getByTestId, getByText } = render(<WelcomeScreen onContinue={jest.fn()} />);
    expect(getByTestId("welcome-screen")).toBeTruthy();
    expect(getByText("Welcome to Winzy")).toBeTruthy();
    expect(getByTestId("welcome-flame")).toBeTruthy();
  });

  it("renders subtitle describing the app", () => {
    const { getByText } = render(<WelcomeScreen onContinue={jest.fn()} />);
    expect(getByText(/Build habits that stick/)).toBeTruthy();
  });

  it("renders CTA button with correct label", () => {
    const { getByText } = render(<WelcomeScreen onContinue={jest.fn()} />);
    expect(getByText("Let's go")).toBeTruthy();
  });

  it("calls onContinue when CTA is pressed", () => {
    const onContinue = jest.fn();
    const { getByTestId } = render(<WelcomeScreen onContinue={onContinue} />);
    fireEvent.press(getByTestId("welcome-button"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  // --- Edge cases ---

  it("renders with a FadeIn animation wrapper", () => {
    const { getByTestId } = render(<WelcomeScreen onContinue={jest.fn()} />);
    expect(getByTestId("fade-in")).toBeTruthy();
  });

  it("has accessible continue button", () => {
    const { getByTestId } = render(<WelcomeScreen onContinue={jest.fn()} />);
    const button = getByTestId("welcome-button");
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Continue to the app");
  });

  it("shows ember flame level for new users", () => {
    const { getByText } = render(<WelcomeScreen onContinue={jest.fn()} />);
    expect(getByText("ember lg")).toBeTruthy();
  });
});
