import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { FriendRow, friendDisplayName } from "../FriendsList";
import type { Friend } from "../../../api/social";

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    friendId: "f1",
    since: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

// --- friendDisplayName ---

describe("friendDisplayName", () => {
  it("returns displayName when available", () => {
    expect(friendDisplayName(makeFriend({ displayName: "Alice Smith" }))).toBe("Alice Smith");
  });

  it("falls back to username", () => {
    expect(friendDisplayName(makeFriend({ username: "alice" }))).toBe("alice");
  });

  it("falls back to truncated friendId", () => {
    expect(friendDisplayName(makeFriend({ friendId: "abcdef12-3456" }))).toBe("User abcdef12");
  });
});

// --- FriendRow ---

describe("FriendRow", () => {
  const defaultProps = {
    friend: makeFriend({ displayName: "Alice Smith", username: "alice" }),
    onOptions: jest.fn(),
    processing: false,
  };

  it("renders friend name and username", () => {
    const { getByText } = render(<FriendRow {...defaultProps} />);
    expect(getByText("Alice Smith")).toBeTruthy();
    expect(getByText("@alice")).toBeTruthy();
  });

  it("renders initials in avatar", () => {
    const { getByText } = render(<FriendRow {...defaultProps} />);
    expect(getByText("AS")).toBeTruthy();
  });

  it("calls onPress with friendId when tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <FriendRow {...defaultProps} onPress={onPress} />,
    );

    fireEvent.press(getByTestId("friend-f1"));
    expect(onPress).toHaveBeenCalledWith("f1");
  });

  it("calls onOptions on long press", () => {
    const onOptions = jest.fn();
    const { getByTestId } = render(
      <FriendRow {...defaultProps} onOptions={onOptions} />,
    );

    fireEvent(getByTestId("friend-f1"), "onLongPress");
    expect(onOptions).toHaveBeenCalled();
  });

  it("calls onOptions when menu button pressed", () => {
    const onOptions = jest.fn();
    const { getByTestId } = render(
      <FriendRow {...defaultProps} onOptions={onOptions} />,
    );

    fireEvent.press(getByTestId("menu-f1"));
    expect(onOptions).toHaveBeenCalled();
  });

  it("disables press when processing", () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <FriendRow {...defaultProps} onPress={onPress} processing />,
    );

    fireEvent.press(getByTestId("friend-f1"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows flame unavailable indicator when habitsUnavailable", () => {
    const friend = makeFriend({ displayName: "Bob", habitsUnavailable: true });
    const { getByTestId } = render(
      <FriendRow friend={friend} onOptions={jest.fn()} processing={false} />,
    );

    expect(getByTestId("flame-unavailable-f1")).toBeTruthy();
  });

  it("renders friends since date", () => {
    const { getByText } = render(<FriendRow {...defaultProps} />);
    // The exact format depends on locale, just check it contains "Friends since"
    expect(getByText(/Friends since/)).toBeTruthy();
  });
});
