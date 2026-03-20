import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { Modal } from "../components/Modal";

describe("Modal", () => {
  // --- Happy path ---

  it("renders children when visible", () => {
    const { getByText } = render(
      <Modal visible onClose={jest.fn()}>
        <Text>Modal content</Text>
      </Modal>,
    );

    expect(getByText("Modal content")).toBeTruthy();
  });

  it("renders title when provided", () => {
    const { getByText } = render(
      <Modal visible onClose={jest.fn()} title="Test Title">
        <Text>Content</Text>
      </Modal>,
    );

    expect(getByText("Test Title")).toBeTruthy();
  });

  it("renders close button in header when title is present", () => {
    const { getByLabelText } = render(
      <Modal visible onClose={jest.fn()} title="Title">
        <Text>Content</Text>
      </Modal>,
    );

    expect(getByLabelText("Close")).toBeTruthy();
  });

  it("calls onClose when close button pressed", () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <Modal visible onClose={onClose} title="Title">
        <Text>Content</Text>
      </Modal>,
    );

    fireEvent.press(getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when overlay backdrop pressed", () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <Modal visible onClose={onClose}>
        <Text>Content</Text>
      </Modal>,
    );

    fireEvent.press(getByLabelText("Close modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --- Edge cases ---

  it("does not render title section when title is omitted", () => {
    const { queryByLabelText } = render(
      <Modal visible onClose={jest.fn()}>
        <Text>Content</Text>
      </Modal>,
    );

    // No close button because no header
    expect(queryByLabelText("Close")).toBeNull();
  });

  it("does not propagate press from content area to overlay", () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <Modal visible onClose={onClose} title="Title">
        <Text>Inner content</Text>
      </Modal>,
    );

    fireEvent.press(getByText("Inner content"));
    expect(onClose).not.toHaveBeenCalled();
  });

  // --- Error conditions ---

  it("does not crash when visible is false", () => {
    const { queryByText } = render(
      <Modal visible={false} onClose={jest.fn()}>
        <Text>Hidden</Text>
      </Modal>,
    );

    // RNModal with visible=false doesn't render children on native
    // This just verifies no crash
    expect(queryByText).toBeDefined();
  });
});
