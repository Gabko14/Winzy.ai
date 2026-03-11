import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { spacing, radii } from "../../design-system/tokens/spacing";
import { typography } from "../../design-system/tokens/typography";
import { lightTheme, brand } from "../../design-system/tokens/colors";
import type { NotificationItem, NotificationType } from "../../api/notifications";

export type NotificationRowProps = {
  notification: NotificationItem;
  onPress: (notification: NotificationItem) => void;
};

// Frontend-owned supportive copy for each notification type
function getNotificationContent(type: NotificationType, data: Record<string, unknown>): {
  title: string;
  body: string;
} {
  switch (type) {
    case "friendrequestsent":
      return {
        title: "New friend request",
        body: "Someone wants to connect with you and share the journey.",
      };
    case "friendrequestaccepted":
      return {
        title: "Friend request accepted",
        body: "You have a new accountability partner. Keep the flame alive together!",
      };
    case "challengecreated":
      return {
        title: "New challenge",
        body: "A friend has set a challenge for you. Ready to take it on?",
      };
    case "challengecompleted": {
      const reward = data.reward as string | undefined;
      return {
        title: "Challenge completed!",
        body: reward
          ? `Great work! Time to enjoy your reward: ${reward}`
          : "Great work! You crushed that challenge.",
      };
    }
    case "habitcompleted":
      return {
        title: "A friend logged a habit",
        body: "Your friend is keeping their flame alive. Stay inspired!",
      };
    default:
      return {
        title: "Notification",
        body: "You have a new notification.",
      };
  }
}

function getTimeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(dateString).toLocaleDateString();
}

export function NotificationRow({ notification, onPress }: NotificationRowProps) {
  const colors = lightTheme;
  const isUnread = notification.readAt === null;
  const content = getNotificationContent(notification.type, notification.data);
  const timeAgo = getTimeAgo(notification.createdAt);

  return (
    <Pressable
      onPress={() => onPress(notification)}
      accessibilityRole="button"
      accessibilityLabel={`${content.title}. ${content.body}. ${timeAgo}${isUnread ? ". Unread" : ""}`}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: isUnread ? brand.flame50 : colors.surface,
          borderBottomColor: colors.border,
        },
        pressed && { backgroundColor: colors.backgroundSecondary },
      ]}
      testID={`notification-row-${notification.id}`}
    >
      {isUnread && (
        <View
          style={[styles.unreadDot, { backgroundColor: colors.brandPrimary }]}
          testID="unread-dot"
        />
      )}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text
            style={[
              styles.title,
              { color: colors.textPrimary },
              isUnread && styles.titleUnread,
            ]}
            numberOfLines={1}
          >
            {content.title}
          </Text>
          <Text style={[styles.time, { color: colors.textTertiary }]}>{timeAgo}</Text>
        </View>
        <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={2}>
          {content.body}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    marginTop: spacing.sm,
    marginRight: spacing.sm,
  },
  content: {
    flex: 1,
    gap: spacing.xs,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    ...typography.label,
    flex: 1,
  },
  titleUnread: {
    fontWeight: "600",
  },
  time: {
    ...typography.caption,
    marginLeft: spacing.sm,
  },
  body: {
    ...typography.bodySmall,
  },
});
