import React, { useCallback } from "react";
import { FlatList, View, StyleSheet, Pressable, Text } from "react-native";
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
  /** Called to navigate back (e.g., to Today screen). */
  onBack?: () => void;
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
  onBack,
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
    async (notification: NotificationItem) => {
      if (notification.readAt === null) {
        onUnreadCountChange?.(-1);
        const ok = await markRead(notification.id);
        if (!ok) {
          onUnreadCountChange?.(1);
        }
      }

      if (onNotificationPress && DEEP_LINK_TYPES.has(notification.type)) {
        onNotificationPress(notification);
      }
    },
    [markRead, onNotificationPress, onUnreadCountChange],
  );

  const handleMarkAllRead = useCallback(async () => {
    const unread = items.filter((item) => item.readAt === null).length;
    onUnreadCountChange?.(-unread);
    const ok = await markAllRead();
    if (!ok) {
      onUnreadCountChange?.(unread);
    }
  }, [items, markAllRead, onUnreadCountChange]);

  const backHeader = onBack ? (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable onPress={onBack} style={styles.backButton} accessibilityLabel="Go back" testID="back-button">
        <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"< Back"}</Text>
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Notifications</Text>
      <View style={styles.headerSpacer} />
    </View>
  ) : null;

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {backHeader}
        <LoadingState message="Loading notifications..." />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {backHeader}
        <ErrorState
          message={error.message}
          onRetry={refresh}
        />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {backHeader}
        <EmptyState
          title="All caught up"
          message="No notifications yet. They'll appear here when your friends interact with you."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="notification-screen">
      {backHeader}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backText: {
    fontSize: 16,
    fontWeight: "600",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  headerSpacer: {
    width: 50,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
});
