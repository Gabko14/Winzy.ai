import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { NotificationRow } from "../NotificationRow";
import type { NotificationItem, NotificationType } from "../../../api/notifications";

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "test-id",
    type: "friendrequestsent",
    data: {},
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("NotificationRow", () => {
  it("renders unread notification with dot indicator", () => {
    const notification = makeNotification({ readAt: null });
    const onPress = jest.fn();

    const { getByTestId, getByText } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    expect(getByTestId("unread-dot")).toBeTruthy();
    expect(getByText("New friend request")).toBeTruthy();
  });

  it("renders read notification without dot", () => {
    const notification = makeNotification({ readAt: "2026-01-01T00:00:00Z" });
    const onPress = jest.fn();

    const { queryByTestId, getByText } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    expect(queryByTestId("unread-dot")).toBeNull();
    expect(getByText("New friend request")).toBeTruthy();
  });

  it("calls onPress with notification when tapped", () => {
    const notification = makeNotification({ id: "n1" });
    const onPress = jest.fn();

    const { getByTestId } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    fireEvent.press(getByTestId("notification-row-n1"));
    expect(onPress).toHaveBeenCalledWith(notification);
  });

  // Test each notification type renders correct copy
  const typeCases: Array<{ type: NotificationType; expectedTitle: string }> = [
    { type: "friendrequestsent", expectedTitle: "New friend request" },
    { type: "friendrequestaccepted", expectedTitle: "Friend request accepted" },
    { type: "challengecreated", expectedTitle: "New challenge" },
    { type: "challengecompleted", expectedTitle: "Challenge completed!" },
    { type: "habitcompleted", expectedTitle: "A friend logged a habit" },
  ];

  typeCases.forEach(({ type, expectedTitle }) => {
    it(`renders ${type} notification with correct title`, () => {
      const notification = makeNotification({ type });
      const onPress = jest.fn();

      const { getByText } = render(
        <NotificationRow notification={notification} onPress={onPress} />,
      );

      expect(getByText(expectedTitle)).toBeTruthy();
    });
  });

  it("renders challenge completed with reward in body", () => {
    const notification = makeNotification({
      type: "challengecompleted",
      data: { reward: "Coffee date" },
    });
    const onPress = jest.fn();

    const { getByText } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    expect(getByText("Great work! Time to enjoy your reward: Coffee date")).toBeTruthy();
  });

  it("renders challenge completed without reward", () => {
    const notification = makeNotification({
      type: "challengecompleted",
      data: {},
    });
    const onPress = jest.fn();

    const { getByText } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    expect(getByText("Great work! You crushed that challenge.")).toBeTruthy();
  });

  it("renders time ago for recent notifications", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const notification = makeNotification({ createdAt: fiveMinutesAgo });
    const onPress = jest.fn();

    const { getByText } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    expect(getByText("5m ago")).toBeTruthy();
  });

  it("renders time ago for hour-old notifications", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const notification = makeNotification({ createdAt: twoHoursAgo });
    const onPress = jest.fn();

    const { getByText } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    expect(getByText("2h ago")).toBeTruthy();
  });

  it("renders time ago for day-old notifications", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const notification = makeNotification({ createdAt: threeDaysAgo });
    const onPress = jest.fn();

    const { getByText } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    expect(getByText("3d ago")).toBeTruthy();
  });

  it("renders accessibility label with unread state", () => {
    const notification = makeNotification({ readAt: null });
    const onPress = jest.fn();

    const { getByTestId } = render(
      <NotificationRow notification={notification} onPress={onPress} />,
    );

    const row = getByTestId("notification-row-test-id");
    expect(row.props.accessibilityLabel).toContain("Unread");
  });
});
