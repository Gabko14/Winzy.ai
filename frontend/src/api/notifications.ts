import { api } from "./client";

// --- Types matching backend contract ---

export type NotificationType =
  | "habitcompleted"
  | "friendrequestsent"
  | "friendrequestaccepted"
  | "challengecreated"
  | "challengecompleted";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsPage = {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type UnreadCountResponse = {
  unreadCount: number;
};

export type MarkAllReadResponse = {
  markedAsRead: number;
};

// --- API functions ---

export function fetchNotifications(page = 1, pageSize = 20): Promise<NotificationsPage> {
  return api.get<NotificationsPage>(`/notifications?page=${page}&pageSize=${pageSize}`);
}

export function fetchUnreadCount(): Promise<UnreadCountResponse> {
  return api.get<UnreadCountResponse>("/notifications/unread-count");
}

export function markNotificationRead(id: string): Promise<NotificationItem> {
  return api.put<NotificationItem>(`/notifications/${id}/read`);
}

export function markAllNotificationsRead(): Promise<MarkAllReadResponse> {
  return api.put<MarkAllReadResponse>("/notifications/read-all");
}
