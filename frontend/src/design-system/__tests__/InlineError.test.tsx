import React from "react";
import { render, screen } from "@testing-library/react-native";
import { InlineError } from "../components/InlineError";

describe("InlineError", () => {
  // --- Happy path ---

  it("renders the error message with error styling", () => {
    render(<InlineError message="Something went wrong" testID="err" />);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    // Verify the banner has a background color set (errorBackground)
    const banner = screen.getByTestId("err");
    const flatStyle = banner.props.style;
    const bgColor = Array.isArray(flatStyle)
      ? flatStyle.find((s: Record<string, unknown>) => s.backgroundColor)?.backgroundColor
      : flatStyle?.backgroundColor;
    expect(bgColor).toBeDefined();
  });

  it("has alert accessibility role", () => {
    render(<InlineError message="Error" testID="error-banner" />);
    const banner = screen.getByTestId("error-banner");
    expect(banner.props.accessibilityRole).toBe("alert");
  });

  it("renders with custom testID", () => {
    render(<InlineError message="Error" testID="server-error" />);
    expect(screen.getByTestId("server-error")).toBeTruthy();
  });

  // --- Edge cases ---

  it("renders with empty message", () => {
    render(<InlineError message="" testID="empty-error" />);
    expect(screen.getByTestId("empty-error")).toBeTruthy();
  });

  it("renders long error messages", () => {
    const longMessage = "A".repeat(500);
    render(<InlineError message={longMessage} />);
    expect(screen.getByText(longMessage)).toBeTruthy();
  });

  it("renders special characters in message", () => {
    render(<InlineError message={'Error: email "test@example.com" is invalid'} />);
    expect(screen.getByText('Error: email "test@example.com" is invalid')).toBeTruthy();
  });
});
