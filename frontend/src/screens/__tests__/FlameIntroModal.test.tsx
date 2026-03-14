import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { FlameIntroModal } from "../FlameIntroModal";

// Mock design system components
jest.mock("../../design-system", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require("react-native");
  return {
    Modal: ({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) => {
      if (!visible) return null;
      return (
        <RN.View testID="modal">
          <RN.Text>{title}</RN.Text>
          <RN.Pressable testID="modal-close" onPress={onClose}>
            <RN.Text>Close</RN.Text>
          </RN.Pressable>
          {children}
        </RN.View>
      );
    },
    Flame: ({ flameLevel }: { flameLevel: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RN2 = require("react-native");
      return <RN2.View testID={`flame-${flameLevel}`} />;
    },
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RN2 = require("react-native");
      return (
        <RN2.Pressable onPress={onPress} testID="flame-intro-dismiss-button">
          <RN2.Text>{title}</RN2.Text>
        </RN2.Pressable>
      );
    },
    spacing: { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, "2xl": 32, "3xl": 40 },
    typography: {
      body: { fontSize: 16 },
      bodySmall: { fontSize: 14 },
      caption: { fontSize: 12 },
    },
    lightTheme: {
      textPrimary: "#1C1917",
      textSecondary: "#57534E",
    },
  };
});

describe("FlameIntroModal", () => {
  // --- Happy path ---

  it("renders when visible is true", () => {
    const { getByTestId } = render(<FlameIntroModal visible={true} onDismiss={jest.fn()} />);
    expect(getByTestId("flame-intro-modal")).toBeTruthy();
  });

  it("shows modal title 'Meet your Flame'", () => {
    const { getByText } = render(<FlameIntroModal visible={true} onDismiss={jest.fn()} />);
    expect(getByText("Meet your Flame")).toBeTruthy();
  });

  it("shows three flame examples (ember, steady, blazing)", () => {
    const { getByTestId } = render(<FlameIntroModal visible={true} onDismiss={jest.fn()} />);
    expect(getByTestId("flame-ember")).toBeTruthy();
    expect(getByTestId("flame-steady")).toBeTruthy();
    expect(getByTestId("flame-blazing")).toBeTruthy();
  });

  it("shows description about consistency", () => {
    const { getByText } = render(<FlameIntroModal visible={true} onDismiss={jest.fn()} />);
    expect(getByText(/consistency over the last 60 days/)).toBeTruthy();
  });

  it("shows encouraging message about missing days", () => {
    const { getByText } = render(<FlameIntroModal visible={true} onDismiss={jest.fn()} />);
    expect(getByText(/Missing a day won't reset your progress/)).toBeTruthy();
  });

  it("calls onDismiss when 'Got it' button is pressed", () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(<FlameIntroModal visible={true} onDismiss={onDismiss} />);
    fireEvent.press(getByTestId("flame-intro-dismiss-button"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // --- Edge cases ---

  it("does not render when visible is false", () => {
    const { queryByTestId } = render(<FlameIntroModal visible={false} onDismiss={jest.fn()} />);
    expect(queryByTestId("flame-intro-modal")).toBeNull();
  });

  it("calls onDismiss when modal close button is pressed", () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(<FlameIntroModal visible={true} onDismiss={onDismiss} />);
    fireEvent.press(getByTestId("modal-close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows 'Got it' as the dismiss button label", () => {
    const { getByText } = render(<FlameIntroModal visible={true} onDismiss={jest.fn()} />);
    expect(getByText("Got it")).toBeTruthy();
  });
});
