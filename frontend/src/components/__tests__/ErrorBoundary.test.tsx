import React from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import { ErrorBoundary } from "../ErrorBoundary";

// Component that throws
function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test crash");
  }
  return <Text testID="child">Content</Text>;
}

// Suppress console.error from React error boundary logging
let consoleSpy: jest.SpyInstance;
beforeEach(() => {
  consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleSpy.mockRestore();
});

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    const { getByTestId } = render(
      <ErrorBoundary>
        <Thrower shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(getByTestId("child").props.children).toBe("Content");
  });

  it("shows fallback UI when child throws", () => {
    const { getByTestId, getByText } = render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(getByTestId("error-boundary-fallback")).toBeTruthy();
    expect(getByText("Oops, something unexpected happened")).toBeTruthy();
    expect(getByText(/your data is safe/)).toBeTruthy();
    expect(getByText("Try again")).toBeTruthy();
  });

  it("recovers when Try again is pressed", () => {
    // We need a component whose throw behavior can change
    let shouldThrow = true;

    function ConditionalThrower() {
      if (shouldThrow) throw new Error("crash");
      return <Text testID="recovered">Recovered</Text>;
    }

    const { getByText, getByTestId } = render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    expect(getByTestId("error-boundary-fallback")).toBeTruthy();

    // Stop throwing before pressing retry
    shouldThrow = false;
    fireEvent.press(getByText("Try again"));

    expect(getByTestId("recovered").props.children).toBe("Recovered");
  });

  it("renders custom fallback when provided", () => {
    const customFallback = <Text testID="custom">Custom fallback</Text>;

    const { getByTestId, queryByTestId } = render(
      <ErrorBoundary fallback={customFallback}>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(getByTestId("custom")).toBeTruthy();
    expect(queryByTestId("error-boundary-fallback")).toBeNull();
  });

  it("logs error details to console.error", () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Our componentDidCatch calls console.error with structured info
    const calls = consoleSpy.mock.calls;
    const ourCall = calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("[ErrorBoundary]"),
    );
    expect(ourCall).toBeTruthy();
  });
});
