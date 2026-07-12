import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Types matching backend contract ---
// Keep in sync with: backend/internal/notifications/models.go
// Spec: backend/openapi/openapi.yaml

export type NotificationType = Schemas["NotificationType"];
export type NotificationItem = Schemas["NotificationItem"];
export type NotificationsPage = Schemas["NotificationsPage"];
export type UnreadCountResponse = Schemas["UnreadCountResponse"];
export type MarkAllReadResponse = Schemas["MarkAllReadResponse"];

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
