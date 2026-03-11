import React from "react";
import { render } from "@testing-library/react-native";
import { OfflineIndicator } from "../OfflineIndicator";

// Mock the actual module path as imported by OfflineIndicator
let mockIsOnline = true;
jest.mock("../../hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockIsOnline,
}));

beforeEach(() => {
  mockIsOnline = true;
});

describe("OfflineIndicator", () => {
  it("renders nothing when online", () => {
    mockIsOnline = true;
    const { queryByTestId } = render(<OfflineIndicator />);
    expect(queryByTestId("offline-indicator")).toBeNull();
  });

  it("shows offline banner when offline", () => {
    mockIsOnline = false;
    const { getByTestId, getByText } = render(<OfflineIndicator />);
    expect(getByTestId("offline-indicator")).toBeTruthy();
    expect(getByText(/offline/i)).toBeTruthy();
  });

  it("has accessible alert role when visible", () => {
    mockIsOnline = false;
    const { getByTestId } = render(<OfflineIndicator />);
    expect(getByTestId("offline-indicator").props.accessibilityRole).toBe("alert");
  });

  it("uses encouraging tone in message", () => {
    mockIsOnline = false;
    const { getByText } = render(<OfflineIndicator />);
    // Should contain positive messaging, not punishing
    expect(getByText(/sync when you/)).toBeTruthy();
  });
});
