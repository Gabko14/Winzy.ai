import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Alert,
} from "react-native";
import {
  Card,
  EmptyState,
  LoadingState,
  ErrorState,
  Badge,
  Button,
  Flame,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { useFriends } from "../hooks/useFriends";
import type { Friend, IncomingRequest, OutgoingRequest } from "../api/social";

// --- Display helpers ---

function friendDisplayName(friend: Friend): string {
  if (friend.displayName) return friend.displayName;
  if (friend.username) return friend.username;
  return `User ${friend.friendId.slice(0, 8)}`;
}

function friendInitials(friend: Friend): string {
  if (friend.displayName) {
    const parts = friend.displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (friend.username) return friend.username.slice(0, 2).toUpperCase();
  return friend.friendId.slice(0, 2).toUpperCase();
}

function incomingDisplayName(request: IncomingRequest): string {
  if (request.fromDisplayName) return request.fromDisplayName;
  if (request.fromUsername) return `@${request.fromUsername}`;
  return `User ${request.fromUserId.slice(0, 8)}`;
}

function incomingInitials(request: IncomingRequest): string {
  if (request.fromDisplayName) {
    const parts = request.fromDisplayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (request.fromUsername) return request.fromUsername.slice(0, 2).toUpperCase();
  return request.fromUserId.slice(0, 2).toUpperCase();
}

function outgoingDisplayName(request: OutgoingRequest): string {
  if (request.toDisplayName) return request.toDisplayName;
  if (request.toUsername) return `@${request.toUsername}`;
  return `User ${request.toUserId.slice(0, 8)}`;
}

function outgoingInitials(request: OutgoingRequest): string {
  if (request.toDisplayName) {
    const parts = request.toDisplayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (request.toUsername) return request.toUsername.slice(0, 2).toUpperCase();
  return request.toUserId.slice(0, 2).toUpperCase();
}

type Props = {
  onAddFriend?: () => void;
  onFriendPress?: (friendId: string) => void;
};

export function FriendsScreen({ onAddFriend, onFriendPress }: Props) {
  const colors = lightTheme;
  const {
    friends,
    totalFriends,
    incoming,
    outgoing,
    loading,
    requestsLoading,
    error,
    requestsError,
    refresh,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
  } = useFriends();

  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const withProcessing = useCallback(
    async (
      id: string,
      action: () => Promise<boolean>,
      onError?: () => void,
    ) => {
      setProcessingIds((s) => new Set(s).add(id));
      const ok = await action();
      setProcessingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      if (!ok) {
        if (onError) {
          onError();
        } else {
          Alert.alert("Something went wrong", "Please try again.");
        }
      }
    },
    [],
  );

  const handleAccept = useCallback(
    (request: IncomingRequest) => {
      withProcessing(request.id, () => acceptRequest(request.id));
    },
    [acceptRequest, withProcessing],
  );

  const handleDecline = useCallback(
    (request: IncomingRequest) => {
      withProcessing(request.id, () => declineRequest(request.id));
    },
    [declineRequest, withProcessing],
  );

  const handleCancelOutgoing = useCallback(
    (request: OutgoingRequest) => {
      Alert.alert(
        "Cancel friend request?",
        "This will withdraw your friend request. You can always send a new one later.",
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Cancel request",
            style: "destructive",
            onPress: () => withProcessing(request.id, () => cancelRequest(request.id)),
          },
        ],
      );
    },
    [cancelRequest, withProcessing],
  );

  const handleRemoveFriend = useCallback(
    (friend: Friend) => {
      Alert.alert(
        "Remove friend?",
        "You won't see each other's flames anymore. You can always reconnect later.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => withProcessing(friend.friendId, () => removeFriend(friend.friendId)),
          },
        ],
      );
    },
    [removeFriend, withProcessing],
  );

  const handleFriendOptions = useCallback(
    (friend: Friend) => {
      const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [];
      if (onFriendPress) {
        buttons.push({
          text: "View Profile",
          onPress: () => onFriendPress(friend.friendId),
        });
      }
      buttons.push({
        text: "Remove Friend",
        style: "destructive",
        onPress: () => handleRemoveFriend(friend),
      });
      buttons.push({ text: "Cancel", style: "cancel" });
      Alert.alert("Friend options", undefined, buttons);
    },
    [onFriendPress, handleRemoveFriend],
  );

  // Initial loading state
  if (loading && friends.length === 0 && requestsLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="friends-loading">
        <LoadingState message="Loading friends..." />
      </View>
    );
  }

  // Error state (both failed)
  if (error && friends.length === 0 && incoming.length === 0 && outgoing.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="friends-error">
        <ErrorState message={error.message} onRetry={refresh} />
      </View>
    );
  }

  const hasPendingRequests = incoming.length > 0 || outgoing.length > 0;
  const isEmpty = friends.length === 0 && !hasPendingRequests;

  // Empty state
  if (!loading && isEmpty) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="friends-empty">
        <Header friendCount={0} onAddFriend={onAddFriend} />
        <View style={styles.emptyContainer}>
          <EmptyState
            title="Add friends to share your journey"
            message="See how your friends are doing at a glance. Their flames show consistency without any pressure."
            actionLabel="Find friends"
            onAction={onAddFriend}
            hideIllustration
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="friends-screen">
      <Header
        friendCount={totalFriends}
        pendingCount={incoming.length}
        onAddFriend={onAddFriend}
      />

      <FlatList
        data={friends}
        keyExtractor={(item) => item.friendId}
        renderItem={({ item }) => (
          <FriendRow
            friend={item}
            onPress={onFriendPress}
            onOptions={() => handleFriendOptions(item)}
            processing={processingIds.has(item.friendId)}
          />
        )}
        ListHeaderComponent={
          <>
            {requestsError && (
              <View style={styles.sectionPadding}>
                <ErrorState message="Could not load friend requests" onRetry={refresh} />
              </View>
            )}
            {hasPendingRequests && (
              <PendingRequestsSection
                incoming={incoming}
                outgoing={outgoing}
                processingIds={processingIds}
                onAccept={handleAccept}
                onDecline={handleDecline}
                onCancel={handleCancelOutgoing}
              />
            )}
          </>
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.brandPrimary}
          />
        }
        testID="friends-list"
      />
    </View>
  );
}

// --- Header ---

type HeaderProps = {
  friendCount: number;
  pendingCount?: number;
  onAddFriend?: () => void;
};

function Header({ friendCount, pendingCount = 0, onAddFriend }: HeaderProps) {
  const colors = lightTheme;

  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Friends</Text>
        {friendCount > 0 && (
          <Text style={[styles.headerCount, { color: colors.textSecondary }]}>
            {friendCount}
          </Text>
        )}
        {pendingCount > 0 && (
          <Badge label={`${pendingCount} new`} variant="warning" />
        )}
      </View>
      {onAddFriend && (
        <Pressable
          onPress={onAddFriend}
          accessibilityRole="button"
          accessibilityLabel="Add friend"
          style={styles.addButton}
          testID="add-friend-button"
        >
          <Text style={[styles.addButtonText, { color: colors.brandPrimary }]}>+</Text>
        </Pressable>
      )}
    </View>
  );
}

// --- Pending Requests Section ---

type PendingRequestsSectionProps = {
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
  processingIds: Set<string>;
  onAccept: (request: IncomingRequest) => void;
  onDecline: (request: IncomingRequest) => void;
  onCancel: (request: OutgoingRequest) => void;
};

function PendingRequestsSection({
  incoming,
  outgoing,
  processingIds,
  onAccept,
  onDecline,
  onCancel,
}: PendingRequestsSectionProps) {
  const colors = lightTheme;

  return (
    <View style={styles.section} testID="pending-requests-section">
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        Pending Requests
      </Text>

      {incoming.map((request) => (
        <Card key={request.id} style={styles.requestCard}>
          <View style={styles.requestRow}>
            <View style={styles.requestAvatar}>
              <Text style={styles.requestAvatarText}>
                {incomingInitials(request)}
              </Text>
            </View>
            <View style={styles.requestInfo}>
              <Text style={[styles.requestName, { color: colors.textPrimary }]} numberOfLines={1}>
                {incomingDisplayName(request)}
              </Text>
              <Text style={[styles.requestMeta, { color: colors.textSecondary }]}>
                Wants to be friends
              </Text>
            </View>
            <View style={styles.requestActions}>
              <Button
                title="Accept"
                onPress={() => onAccept(request)}
                variant="primary"
                size="sm"
                disabled={processingIds.has(request.id)}
                loading={processingIds.has(request.id)}
              />
              <Button
                title="Decline"
                onPress={() => onDecline(request)}
                variant="ghost"
                size="sm"
                disabled={processingIds.has(request.id)}
              />
            </View>
          </View>
        </Card>
      ))}

      {outgoing.map((request) => (
        <Card key={request.id} style={styles.requestCard}>
          <View style={styles.requestRow}>
            <View style={styles.requestAvatar}>
              <Text style={styles.requestAvatarText}>
                {outgoingInitials(request)}
              </Text>
            </View>
            <View style={styles.requestInfo}>
              <Text style={[styles.requestName, { color: colors.textPrimary }]} numberOfLines={1}>
                {outgoingDisplayName(request)}
              </Text>
              <Badge label="Pending" variant="default" />
            </View>
            <Button
              title="Cancel"
              onPress={() => onCancel(request)}
              variant="ghost"
              size="sm"
              disabled={processingIds.has(request.id)}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}

// --- Friend Row ---

type FriendRowProps = {
  friend: Friend;
  onPress?: (friendId: string) => void;
  onOptions: () => void;
  processing: boolean;
};

function FriendRow({ friend, onPress, onOptions, processing }: FriendRowProps) {
  const colors = lightTheme;
  const name = friendDisplayName(friend);
  const initials = friendInitials(friend);
  const flameLevel = friend.flameLevel ?? "none";

  return (
    <Card style={styles.friendCard}>
      <Pressable
        style={styles.friendRow}
        onPress={() => onPress?.(friend.friendId)}
        onLongPress={onOptions}
        accessibilityRole="button"
        accessibilityLabel={`Friend ${name}`}
        accessibilityHint="Tap to view profile"
        testID={`friend-${friend.friendId}`}
        disabled={processing}
      >
        <View style={[styles.avatar, { backgroundColor: colors.brandMuted }]}>
          <Text style={styles.avatarText}>
            {initials}
          </Text>
        </View>

        <View style={styles.friendInfo}>
          <Text style={[styles.friendName, { color: colors.textPrimary }]} numberOfLines={1}>
            {name}
          </Text>
          {friend.username && (
            <Text style={[styles.friendUsername, { color: colors.textSecondary }]} numberOfLines={1}>
              @{friend.username}
            </Text>
          )}
          <Text style={[styles.friendSince, { color: colors.textSecondary }]}>
            Friends since {new Date(friend.since).toLocaleDateString()}
          </Text>
        </View>

        <View style={styles.flameContainer} testID={`flame-${friend.friendId}`}>
          <Flame flameLevel={flameLevel} size="sm" consistency={friend.consistency} />
        </View>

        <Pressable
          onPress={onOptions}
          accessibilityRole="button"
          accessibilityLabel={`Options for ${name}`}
          hitSlop={8}
          style={styles.menuButton}
          testID={`menu-${friend.friendId}`}
          disabled={processing}
        >
          <Text style={[styles.menuIcon, { color: colors.textSecondary }]}>
            {"\u2026"}
          </Text>
        </Pressable>
      </Pressable>
    </Card>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerTitle: {
    ...typography.h2,
  },
  headerCount: {
    ...typography.bodyLarge,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    fontSize: 28,
    fontWeight: "300",
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  sectionPadding: {
    paddingBottom: spacing.base,
  },
  sectionTitle: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  requestCard: {
    padding: 0,
    ...shadows.sm,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  requestAvatar: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    backgroundColor: lightTheme.brandMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  requestAvatarText: {
    fontSize: 12,
    fontWeight: "600",
    color: lightTheme.brandPrimary,
  },
  requestInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  requestName: {
    ...typography.body,
    fontWeight: "600",
  },
  requestMeta: {
    ...typography.caption,
  },
  requestActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  friendCard: {
    padding: 0,
    ...shadows.sm,
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: lightTheme.brandPrimary,
  },
  friendInfo: {
    flex: 1,
  },
  flameContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.xs,
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  menuIcon: {
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: 1,
  },
  friendName: {
    ...typography.body,
    fontWeight: "600",
  },
  friendUsername: {
    ...typography.bodySmall,
  },
  friendSince: {
    ...typography.caption,
  },
});
