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
  EmptyState,
  LoadingState,
  ErrorState,
  Badge,
} from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { useFriends } from "../hooks/useFriends";
import type { Friend, IncomingRequest, OutgoingRequest } from "../api/social";
import { FriendRow } from "../components/friends/FriendsList";
import { IncomingRequestsList } from "../components/friends/IncomingRequests";
import { OutgoingRequestsList } from "../components/friends/OutgoingRequests";

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

      <IncomingRequestsList
        incoming={incoming}
        processingIds={processingIds}
        onAccept={onAccept}
        onDecline={onDecline}
      />

      <OutgoingRequestsList
        outgoing={outgoing}
        processingIds={processingIds}
        onCancel={onCancel}
      />
    </View>
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
});
