import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
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
  markRead: jest.fn().mockResolvedValue(true),
  markAllRead: jest.fn().mockResolvedValue(true),
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
  mockUseNotifications.markRead.mockResolvedValue(true);
  mockUseNotifications.markAllRead.mockResolvedValue(true);
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

  it("calls markAllRead and onUnreadCountChange when mark all is pressed", async () => {
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

    await waitFor(() => {
      expect(mockUseNotifications.markAllRead).toHaveBeenCalled();
      expect(onUnreadCountChange).toHaveBeenCalledWith(-2);
    });
  });

  it("rolls back onUnreadCountChange when markAllRead fails (no onMarkAllReadFailed)", async () => {
    const onUnreadCountChange = jest.fn();
    mockUseNotifications.markAllRead.mockResolvedValue(false);
    mockUseNotifications.items = [
      makeNotification({ id: "n1", readAt: null }),
      makeNotification({ id: "n2", readAt: null }),
    ];
    mockUseNotifications.total = 2;

    const { getByText } = render(
      <NotificationScreen onUnreadCountChange={onUnreadCountChange} />,
    );

    fireEvent.press(getByText("Mark all as read"));

    await waitFor(() => {
      expect(onUnreadCountChange).toHaveBeenCalledWith(-2);
      expect(onUnreadCountChange).toHaveBeenCalledWith(2);
    });
  });

  it("calls onMarkAllReadFailed instead of manual delta rollback when markAllRead fails", async () => {
    const onMarkAllRead = jest.fn();
    const onMarkAllReadFailed = jest.fn();
    const onUnreadCountChange = jest.fn();
    mockUseNotifications.markAllRead.mockResolvedValue(false);
    mockUseNotifications.items = [
      makeNotification({ id: "n1", readAt: null }),
      makeNotification({ id: "n2", readAt: null }),
    ];
    mockUseNotifications.total = 2;

    const { getByText } = render(
      <NotificationScreen
        onMarkAllRead={onMarkAllRead}
        onMarkAllReadFailed={onMarkAllReadFailed}
        onUnreadCountChange={onUnreadCountChange}
      />,
    );

    fireEvent.press(getByText("Mark all as read"));

    await waitFor(() => {
      expect(onMarkAllRead).toHaveBeenCalled();
      expect(onMarkAllReadFailed).toHaveBeenCalled();
      // Should NOT fall back to manual delta when onMarkAllReadFailed is provided
      expect(onUnreadCountChange).not.toHaveBeenCalledWith(2);
    });
  });

  it("does not call onMarkAllReadFailed when markAllRead succeeds", async () => {
    const onMarkAllRead = jest.fn();
    const onMarkAllReadFailed = jest.fn();
    mockUseNotifications.markAllRead.mockResolvedValue(true);
    mockUseNotifications.items = [
      makeNotification({ id: "n1", readAt: null }),
    ];
    mockUseNotifications.total = 1;

    const { getByText } = render(
      <NotificationScreen
        onMarkAllRead={onMarkAllRead}
        onMarkAllReadFailed={onMarkAllReadFailed}
      />,
    );

    fireEvent.press(getByText("Mark all as read"));

    await waitFor(() => {
      expect(onMarkAllRead).toHaveBeenCalled();
      expect(onMarkAllReadFailed).not.toHaveBeenCalled();
    });
  });

  it("marks notification as read on press and calls onNotificationPress for deep-linkable types", async () => {
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

    await waitFor(() => {
      expect(mockUseNotifications.markRead).toHaveBeenCalledWith("n1");
      expect(onUnreadCountChange).toHaveBeenCalledWith(-1);
      expect(onNotificationPress).toHaveBeenCalledWith(notification);
    });
  });

  it("rolls back onUnreadCountChange when markRead fails", async () => {
    const onUnreadCountChange = jest.fn();
    mockUseNotifications.markRead.mockResolvedValue(false);
    const notification = makeNotification({ id: "n1", type: "challengecreated", readAt: null });
    mockUseNotifications.items = [notification];
    mockUseNotifications.total = 1;

    const { getByTestId } = render(
      <NotificationScreen onUnreadCountChange={onUnreadCountChange} />,
    );

    fireEvent.press(getByTestId("notification-row-n1"));

    await waitFor(() => {
      expect(onUnreadCountChange).toHaveBeenCalledWith(-1);
      expect(onUnreadCountChange).toHaveBeenCalledWith(1);
    });
  });

  it("calls onNotificationPress for habitcompleted notifications (deep-linkable)", async () => {
    const onNotificationPress = jest.fn();
    const notification = makeNotification({ id: "n1", type: "habitcompleted", readAt: null, data: { fromUserId: "friend-abc" } });
    mockUseNotifications.items = [notification];
    mockUseNotifications.total = 1;

    const { getByTestId } = render(
      <NotificationScreen onNotificationPress={onNotificationPress} />,
    );

    fireEvent.press(getByTestId("notification-row-n1"));

    await waitFor(() => {
      expect(onNotificationPress).toHaveBeenCalledWith(notification);
    });
  });

  it("does not call markRead for already-read notifications", () => {
    const notification = makeNotification({ id: "n1", readAt: "2026-01-01T00:00:00Z" });
    mockUseNotifications.items = [notification];
    mockUseNotifications.total = 1;

    const { getByTestId } = render(<NotificationScreen />);

    fireEvent.press(getByTestId("notification-row-n1"));

    expect(mockUseNotifications.markRead).not.toHaveBeenCalled();
  });

  it("renders back button when onBack is provided", () => {
    const onBack = jest.fn();
    mockUseNotifications.items = [makeNotification({ id: "n1" })];
    mockUseNotifications.total = 1;

    const { getByTestId } = render(<NotificationScreen onBack={onBack} />);

    const backButton = getByTestId("back-button");
    expect(backButton).toBeTruthy();

    fireEvent.press(backButton);
    expect(onBack).toHaveBeenCalled();
  });

  it("does not render back button when onBack is not provided", () => {
    mockUseNotifications.items = [makeNotification({ id: "n1" })];
    mockUseNotifications.total = 1;

    const { queryByTestId } = render(<NotificationScreen />);

    expect(queryByTestId("back-button")).toBeNull();
  });

  it("shows back button in loading state", () => {
    const onBack = jest.fn();
    mockUseNotifications.loading = true;

    const { getByTestId } = render(<NotificationScreen onBack={onBack} />);

    expect(getByTestId("back-button")).toBeTruthy();
  });

  it("shows back button in empty state", () => {
    const onBack = jest.fn();
    mockUseNotifications.items = [];
    mockUseNotifications.total = 0;

    const { getByTestId } = render(<NotificationScreen onBack={onBack} />);

    expect(getByTestId("back-button")).toBeTruthy();
  });

  it("shows back button in error state", () => {
    const onBack = jest.fn();
    mockUseNotifications.error = {
      status: 500,
      code: "server_error",
      message: "Server error",
    };

    const { getByTestId } = render(<NotificationScreen onBack={onBack} />);

    expect(getByTestId("back-button")).toBeTruthy();
  });
});
