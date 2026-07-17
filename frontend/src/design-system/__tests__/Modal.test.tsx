import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Text, Platform } from "react-native";
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

  it("backdrop is not keyboard-activatable", () => {
    const { getByLabelText } = render(
      <Modal visible onClose={jest.fn()}>
        <Text>Content</Text>
      </Modal>,
    );

    const backdrop = getByLabelText("Close modal");
    expect(backdrop.props.accessibilityRole).toBe("none");
    expect(backdrop.props.focusable).toBe(false);
  });

  it("closes on Escape on web while mounted", () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const onClose = jest.fn();
    const listeners: Record<string, EventListener[]> = {};
    const originalWindow = globalThis.window;
    const mockWindow = {
      addEventListener: jest.fn((event: string, handler: EventListener) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: jest.fn((event: string, handler: EventListener) => {
        listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
      }),
    };

    try {
      Object.defineProperty(globalThis, "window", {
        value: mockWindow,
        configurable: true,
        writable: true,
      });

      const { unmount } = render(
        <Modal visible onClose={onClose}>
          <Text>Content</Text>
        </Modal>,
      );

      expect(mockWindow.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
      const handler = listeners.keydown?.[0];
      expect(handler).toBeDefined();
      handler?.({ key: "Escape", preventDefault: jest.fn() } as unknown as Event);
      expect(onClose).toHaveBeenCalledTimes(1);

      unmount();
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
      Platform.OS = originalOS;
    }
  });

  it("does not close on Space key when no button is focused", () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const onClose = jest.fn();
    const listeners: Record<string, EventListener[]> = {};
    const originalWindow = globalThis.window;
    const mockWindow = {
      addEventListener: jest.fn((event: string, handler: EventListener) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: jest.fn(),
    };

    try {
      Object.defineProperty(globalThis, "window", {
        value: mockWindow,
        configurable: true,
        writable: true,
      });

      const { unmount } = render(
        <Modal visible onClose={onClose}>
          <Text>Content</Text>
        </Modal>,
      );

      const handler = listeners.keydown?.[0];
      expect(handler).toBeDefined();
      handler?.({ key: " ", preventDefault: jest.fn() } as unknown as Event);
      expect(onClose).not.toHaveBeenCalled();
      unmount();
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
      Platform.OS = originalOS;
    }
  });

  it("does not listen for Escape when not visible", () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const onClose = jest.fn();
    const originalWindow = globalThis.window;
    const mockWindow = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    try {
      Object.defineProperty(globalThis, "window", {
        value: mockWindow,
        configurable: true,
        writable: true,
      });

      render(
        <Modal visible={false} onClose={onClose}>
          <Text>Hidden</Text>
        </Modal>,
      );

      expect(mockWindow.addEventListener).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
      Platform.OS = originalOS;
    }
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
