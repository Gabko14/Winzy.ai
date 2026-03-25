import React from "react";
import { Text } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ScreenHeader } from "../components/ScreenHeader";

describe("ScreenHeader", () => {
  // --- Happy path ---

  it("renders the title", () => {
    render(<ScreenHeader title="Settings" />);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders the title with header accessibility role", () => {
    render(<ScreenHeader title="Settings" />);
    expect(screen.getByRole("header")).toBeTruthy();
  });

  it("renders back button with arrow and accessibility label when onBack is provided", () => {
    const onBack = jest.fn();
    render(<ScreenHeader title="Settings" onBack={onBack} />);
    const backButton = screen.getByTestId("back-button");
    expect(backButton).toBeTruthy();
    expect(backButton.props.accessibilityLabel).toBe("Go back");
    expect(backButton.props.accessibilityRole).toBe("button");
    expect(screen.getByText("\u2190")).toBeTruthy();
  });

  it("calls onBack when back button is pressed", () => {
    const onBack = jest.fn();
    render(<ScreenHeader title="Settings" onBack={onBack} />);
    fireEvent.press(screen.getByTestId("back-button"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders right content when provided", () => {
    render(
      <ScreenHeader title="Settings" right={<Text testID="right-action">Edit</Text>} />
    );
    expect(screen.getByTestId("right-action")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
  });

  // --- Edge cases ---

  it("does not render back button when onBack is not provided", () => {
    render(<ScreenHeader title="Settings" />);
    expect(screen.queryByTestId("back-button")).toBeNull();
  });

  it("uses custom backTestID when provided", () => {
    const onBack = jest.fn();
    render(<ScreenHeader title="Stats" onBack={onBack} backTestID="stats-back-button" />);
    expect(screen.getByTestId("stats-back-button")).toBeTruthy();
    expect(screen.queryByTestId("back-button")).toBeNull();
  });

  it("renders with custom testID", () => {
    render(<ScreenHeader title="Test" testID="my-header" />);
    expect(screen.getByTestId("my-header")).toBeTruthy();
  });

  it("truncates long titles to one line", () => {
    render(<ScreenHeader title="A very long title that should be truncated to a single line" />);
    const title = screen.getByRole("header");
    expect(title.props.numberOfLines).toBe(1);
  });

  it("renders with empty title", () => {
    render(<ScreenHeader title="" />);
    expect(screen.getByRole("header")).toBeTruthy();
  });

  it("merges custom style onto the header container", () => {
    render(
      <ScreenHeader
        title="Settings"
        style={{ paddingTop: 32, marginBottom: 24 }}
        testID="styled-header"
      />
    );
    const header = screen.getByTestId("styled-header");
    const flatStyle = Array.isArray(header.props.style)
      ? header.props.style.find((s: Record<string, unknown>) => s.paddingTop === 32)
      : header.props.style;
    expect(flatStyle).toBeDefined();
    expect(flatStyle?.paddingTop).toBe(32);
    expect(flatStyle?.marginBottom).toBe(24);
  });
});
