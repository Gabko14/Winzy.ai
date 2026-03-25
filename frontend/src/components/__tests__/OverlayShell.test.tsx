import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { OverlayShell } from "../OverlayShell";

jest.mock("../OfflineIndicator", () => ({
  OfflineIndicator: () => {
    const { Text: RNText } = jest.requireActual("react-native");
    return <RNText testID="offline-indicator">offline</RNText>;
  },
}));

jest.mock("../ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-status-bar", () => ({
  StatusBar: () => null,
}));

describe("OverlayShell", () => {
  // --- Happy path ---

  it("renders children", () => {
    render(
      <OverlayShell>
        <Text testID="child">Hello</Text>
      </OverlayShell>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("renders OfflineIndicator", () => {
    render(
      <OverlayShell>
        <Text>Content</Text>
      </OverlayShell>,
    );
    expect(screen.getByTestId("offline-indicator")).toBeTruthy();
  });

  // --- Edge cases ---

  it("renders with multiple children", () => {
    render(
      <OverlayShell>
        <Text testID="child-1">First</Text>
        <Text testID="child-2">Second</Text>
      </OverlayShell>,
    );
    expect(screen.getByTestId("child-1")).toBeTruthy();
    expect(screen.getByTestId("child-2")).toBeTruthy();
  });

  it("renders with null children without crashing", () => {
    render(
      <OverlayShell>
        {null}
      </OverlayShell>,
    );
    expect(screen.getByTestId("offline-indicator")).toBeTruthy();
  });
});
