import { act, waitFor } from "@testing-library/react-native";
import { useNotifications } from "../useNotifications";
import type { NotificationItem, NotificationsPage } from "../../api/notifications";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";

jest.mock("../../api/notifications", () => ({
  fetchNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
}));

const {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = jest.requireMock("../../api/notifications");

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

function makePage(
  items: NotificationItem[],
  total?: number,
  page = 1,
  pageSize = 20,
): NotificationsPage {
  return { items, page, pageSize, total: total ?? items.length };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useNotifications", () => {
  it("loads notifications on mount", async () => {
    const items = [makeNotification(), makeNotification()];
    fetchNotifications.mockResolvedValue(makePage(items, 2));

    const { result } = renderHookWithQueryClient(() => useNotifications());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("handles fetch error", async () => {
    const error = { status: 500, code: "server_error", message: "Server error" };
    fetchNotifications.mockRejectedValue(error);

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(error);
    expect(result.current.items).toHaveLength(0);
  });

  it("returns empty list", async () => {
    fetchNotifications.mockResolvedValue(makePage([], 0));

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.total).toBe(0);
    expect(result.current.hasMore).toBe(false);
  });

  it("supports pagination with loadMore", async () => {
    const page1 = [makeNotification({ id: "1" }), makeNotification({ id: "2" })];
    const page2 = [makeNotification({ id: "3" })];
    fetchNotifications
      .mockResolvedValueOnce(makePage(page1, 3, 1, 2))
      .mockResolvedValueOnce(makePage(page2, 3, 2, 2));

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(2);

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(3);
    });

    expect(result.current.hasMore).toBe(false);
  });

  it("does not loadMore when already loading or no more items", async () => {
    fetchNotifications.mockResolvedValue(makePage([makeNotification()], 1));

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(false);

    await act(async () => {
      result.current.loadMore();
    });

    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it("markRead optimistically updates then confirms", async () => {
    const notification = makeNotification({ id: "n1", readAt: null });
    const readNotification = { ...notification, readAt: "2026-01-01T00:00:00Z" };
    fetchNotifications
      .mockResolvedValueOnce(makePage([notification], 1))
      .mockResolvedValue(makePage([readNotification], 1));
    markNotificationRead.mockResolvedValue(readNotification);

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markRead("n1");
    });

    await waitFor(() => {
      expect(result.current.items[0].readAt).not.toBeNull();
    });

    expect(markNotificationRead).toHaveBeenCalledWith("n1");
  });

  it("markRead reverts on error", async () => {
    const notification = makeNotification({ id: "n1", readAt: null });
    fetchNotifications.mockResolvedValue(makePage([notification], 1));
    markNotificationRead.mockRejectedValue(new Error("Network error"));

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success = true;
    await act(async () => {
      success = await result.current.markRead("n1");
    });

    expect(success).toBe(false);

    await waitFor(() => {
      expect(result.current.items[0].readAt).toBeNull();
    });
  });

  it("markAllRead optimistically updates all unread", async () => {
    const items = [
      makeNotification({ id: "n1", readAt: null }),
      makeNotification({ id: "n2", readAt: "2026-01-01T00:00:00Z" }),
      makeNotification({ id: "n3", readAt: null }),
    ];
    const readItems = items.map((item) =>
      item.readAt ? item : { ...item, readAt: "2026-01-02T00:00:00Z" },
    );
    fetchNotifications
      .mockResolvedValueOnce(makePage(items, 3))
      .mockResolvedValue(makePage(readItems, 3));
    markAllNotificationsRead.mockResolvedValue({ markedAsRead: 2 });

    const { result, queryClient } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAllRead();
    });

    await waitFor(() => {
      expect(result.current.items.every((item) => item.readAt !== null)).toBe(true);
    });

    expect(queryClient.getQueryData(["notifications", "unread-count"])).toEqual({
      unreadCount: 0,
    });
  });

  it("markAllRead reverts on error", async () => {
    const items = [
      makeNotification({ id: "n1", readAt: null }),
      makeNotification({ id: "n2", readAt: null }),
    ];
    fetchNotifications.mockResolvedValue(makePage(items, 2));
    markAllNotificationsRead.mockRejectedValue(new Error("Server error"));

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success = true;
    await act(async () => {
      success = await result.current.markAllRead();
    });

    expect(success).toBe(false);

    await waitFor(() => {
      expect(result.current.items.filter((item) => item.readAt === null)).toHaveLength(2);
    });
  });

  it("refresh reloads from page 1", async () => {
    const initial = [makeNotification({ id: "old" })];
    const refreshed = [makeNotification({ id: "new" })];
    fetchNotifications
      .mockResolvedValueOnce(makePage(initial, 1))
      .mockResolvedValueOnce(makePage(refreshed, 1));

    const { result } = renderHookWithQueryClient(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.items[0].id).toBe("new");
    });
  });
});
