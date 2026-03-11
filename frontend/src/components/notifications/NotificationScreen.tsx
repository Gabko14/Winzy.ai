import React, { useCallback } from "react";
import { FlatList, View, StyleSheet } from "react-native";
import { spacing } from "../../design-system/tokens/spacing";
import { lightTheme } from "../../design-system/tokens/colors";
import { EmptyState, LoadingState, ErrorState, Button } from "../../design-system";
import { useNotifications } from "../../hooks/useNotifications";
import { NotificationRow } from "./NotificationRow";
import type { NotificationItem, NotificationType } from "../../api/notifications";

export type NotificationScreenProps = {
  /** Called when a notification is tapped. Receives the notification for deep-link routing. */
  onNotificationPress?: (notification: NotificationItem) => void;
  /** Called when unread count changes (e.g., after mark-read). */
  onUnreadCountChange?: (delta: number) => void;
};

// Deep link targets by notification type
const DEEP_LINK_TYPES = new Set<NotificationType>([
  "friendrequestsent",
  "friendrequestaccepted",
  "challengecreated",
  "challengecompleted",
]);

export function NotificationScreen({
  onNotificationPress,
  onUnreadCountChange,
}: NotificationScreenProps) {
  const {
    items,
    loading,
    loadingMore,
    error,
    hasMore,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  } = useNotifications();

  const colors = lightTheme;
  const hasUnread = items.some((item) => item.readAt === null);

  const handlePress = useCallback(
    (notification: NotificationItem) => {
      if (notification.readAt === null) {
        markRead(notification.id);
        onUnreadCountChange?.(-1);
      }

      if (onNotificationPress && DEEP_LINK_TYPES.has(notification.type)) {
        onNotificationPress(notification);
      }
    },
    [markRead, onNotificationPress, onUnreadCountChange],
  );

  const handleMarkAllRead = useCallback(() => {
    const unreadCount = items.filter((item) => item.readAt === null).length;
    markAllRead();
    onUnreadCountChange?.(-unreadCount);
  }, [items, markAllRead, onUnreadCountChange]);

  if (loading) {
    return <LoadingState message="Loading notifications..." />;
  }

  if (error) {
    return (
      <ErrorState
        message={error.message}
        onRetry={refresh}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="All caught up"
        message="No notifications yet. They'll appear here when your friends interact with you."
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="notification-screen">
      {hasUnread && (
        <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
          <Button
            title="Mark all as read"
            onPress={handleMarkAllRead}
            variant="ghost"
            size="sm"
            accessibilityLabel="Mark all notifications as read"
          />
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationRow notification={item} onPress={handlePress} />
        )}
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.5}
        refreshing={false}
        onRefresh={refresh}
        ListFooterComponent={
          loadingMore ? <LoadingState message="Loading more..." /> : null
        }
        testID="notifications-list"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
});
