import React from "react";
import { render } from "@testing-library/react-native";
import { UnreadBadge } from "../UnreadBadge";

describe("UnreadBadge", () => {
  it("renders nothing when count is 0", () => {
    const { queryByTestId } = render(<UnreadBadge count={0} />);
    expect(queryByTestId("unread-badge")).toBeNull();
  });

  it("renders nothing when count is negative", () => {
    const { queryByTestId } = render(<UnreadBadge count={-1} />);
    expect(queryByTestId("unread-badge")).toBeNull();
  });

  it("renders count for small numbers", () => {
    const { getByTestId, getByText } = render(<UnreadBadge count={5} />);
    expect(getByTestId("unread-badge")).toBeTruthy();
    expect(getByText("5")).toBeTruthy();
  });

  it("renders count for double digits", () => {
    const { getByText } = render(<UnreadBadge count={42} />);
    expect(getByText("42")).toBeTruthy();
  });

  it("caps display at 99+", () => {
    const { getByText } = render(<UnreadBadge count={150} />);
    expect(getByText("99+")).toBeTruthy();
  });

  it("renders exactly 99 without plus", () => {
    const { getByText } = render(<UnreadBadge count={99} />);
    expect(getByText("99")).toBeTruthy();
  });

  it("renders 100 as 99+", () => {
    const { getByText } = render(<UnreadBadge count={100} />);
    expect(getByText("99+")).toBeTruthy();
  });

  it("renders count of 1", () => {
    const { getByText, getByTestId } = render(<UnreadBadge count={1} />);
    expect(getByText("1")).toBeTruthy();
    // Accessibility label should be singular
    expect(getByTestId("unread-badge").props.accessibilityLabel).toBe(
      "1 unread notification",
    );
  });

  it("uses plural accessibility label for multiple", () => {
    const { getByTestId } = render(<UnreadBadge count={5} />);
    expect(getByTestId("unread-badge").props.accessibilityLabel).toBe(
      "5 unread notifications",
    );
  });
});
