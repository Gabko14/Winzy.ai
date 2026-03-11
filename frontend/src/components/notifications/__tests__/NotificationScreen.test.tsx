import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { NotificationScreen } from "../NotificationScreen";
import type { NotificationItem } from "../../../api/notifications";

// Mock the useNotifications hook
const mockUseNotifications = {
  items: [] as NotificationItem[],
  total: 0,
  loading: false,
  loadingMore: false,
  error: null as null | { status: number; code: string; message: string },
  hasMore: false,
  refresh: jest.fn(),
  loadMore: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
};

jest.mock("../../../hooks/useNotifications", () => ({
  useNotifications: () => mockUseNotifications,
}));

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: Math.random().toString(36).slice(2),
    type: "friendrequestsent",
    data: {},
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseNotifications.items = [];
  mockUseNotifications.total = 0;
  mockUseNotifications.loading = false;
  mockUseNotifications.loadingMore = false;
  mockUseNotifications.error = null;
  mockUseNotifications.hasMore = false;
});

describe("NotificationScreen", () => {
  it("shows loading state", () => {
    mockUseNotifications.loading = true;

    const { getByTestId } = render(<NotificationScreen />);

    expect(getByTestId("loading-state")).toBeTruthy();
  });

  it("shows error state with retry", () => {
    mockUseNotifications.error = {
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    };

    const { getByText } = render(<NotificationScreen />);

    expect(getByText("Something went wrong")).toBeTruthy();
    expect(getByText("Something went wrong on our end. Please try again.")).toBeTruthy();

    fireEvent.press(getByText("Try again"));
    expect(mockUseNotifications.refresh).toHaveBeenCalled();
  });

  it("shows empty state when no notifications", () => {
    mockUseNotifications.items = [];
    mockUseNotifications.total = 0;

    const { getByText } = render(<NotificationScreen />);

    expect(getByText("All caught up")).toBeTruthy();
    expect(
      getByText("No notifications yet. They'll appear here when your friends interact with you."),
    ).toBeTruthy();
  });

  it("renders notification list", () => {
    const items = [
      makeNotification({ id: "n1", type: "friendrequestsent" }),
      makeNotification({ id: "n2", type: "challengecreated", readAt: "2026-01-01T00:00:00Z" }),
    ];
    mockUseNotifications.items = items;
    mockUseNotifications.total = 2;

    const { getByTestId } = render(<NotificationScreen />);

    expect(getByTestId("notification-screen")).toBeTruthy();
    expect(getByTestId("notifications-list")).toBeTruthy();
    expect(getByTestId("notification-row-n1")).toBeTruthy();
    expect(getByTestId("notification-row-n2")).toBeTruthy();
  });

  it("shows mark all read button when there are unread notifications", () => {
    mockUseNotifications.items = [makeNotification({ id: "n1", readAt: null })];
    mockUseNotifications.total = 1;

    const { getByText } = render(<NotificationScreen />);

    expect(getByText("Mark all as read")).toBeTruthy();
  });

  it("hides mark all read button when all notifications are read", () => {
    mockUseNotifications.items = [
      makeNotification({ id: "n1", readAt: "2026-01-01T00:00:00Z" }),
    ];
    mockUseNotifications.total = 1;

    const { queryByText } = render(<NotificationScreen />);

    expect(queryByText("Mark all as read")).toBeNull();
  });

  it("calls markAllRead and onUnreadCountChange when mark all is pressed", () => {
    const onUnreadCountChange = jest.fn();
    mockUseNotifications.items = [
      makeNotification({ id: "n1", readAt: null }),
      makeNotification({ id: "n2", readAt: null }),
      makeNotification({ id: "n3", readAt: "2026-01-01T00:00:00Z" }),
    ];
    mockUseNotifications.total = 3;

    const { getByText } = render(
      <NotificationScreen onUnreadCountChange={onUnreadCountChange} />,
    );

    fireEvent.press(getByText("Mark all as read"));

    expect(mockUseNotifications.markAllRead).toHaveBeenCalled();
    expect(onUnreadCountChange).toHaveBeenCalledWith(-2);
  });

  it("marks notification as read on press and calls onNotificationPress for deep-linkable types", () => {
    const onNotificationPress = jest.fn();
    const onUnreadCountChange = jest.fn();
    const notification = makeNotification({ id: "n1", type: "challengecreated", readAt: null });
    mockUseNotifications.items = [notification];
    mockUseNotifications.total = 1;

    const { getByTestId } = render(
      <NotificationScreen
        onNotificationPress={onNotificationPress}
        onUnreadCountChange={onUnreadCountChange}
      />,
    );

    fireEvent.press(getByTestId("notification-row-n1"));

    expect(mockUseNotifications.markRead).toHaveBeenCalledWith("n1");
    expect(onUnreadCountChange).toHaveBeenCalledWith(-1);
    expect(onNotificationPress).toHaveBeenCalledWith(notification);
  });

  it("does not call markRead for already-read notifications", () => {
    const notification = makeNotification({ id: "n1", readAt: "2026-01-01T00:00:00Z" });
    mockUseNotifications.items = [notification];
    mockUseNotifications.total = 1;

    const { getByTestId } = render(<NotificationScreen />);

    fireEvent.press(getByTestId("notification-row-n1"));

    expect(mockUseNotifications.markRead).not.toHaveBeenCalled();
  });
});
