import React, { useCallback, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { AuthNavigator } from "./AuthNavigator";
import { LoadingState, EmptyState } from "../design-system";
import { spacing, lightTheme } from "../design-system";
import { StatusBar } from "expo-status-bar";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { ProfileCompletionScreen } from "../screens/ProfileCompletionScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { EditProfileScreen } from "../screens/EditProfileScreen";
import { HabitListScreen } from "../screens/HabitListScreen";
import { TodayScreen } from "../screens/TodayScreen";
import { HabitDetailScreen } from "../screens/HabitDetailScreen";
import { PublicFlameScreen } from "../screens/PublicFlameScreen";
import { NotificationScreen } from "../components/notifications";
import { FriendsScreen } from "../screens/FriendsScreen";
import { AddFriendScreen } from "../screens/AddFriendScreen";
import { useUnreadCount } from "../hooks/useUnreadCount";
import { TabBar, type TabId } from "./TabBar";

/** Screens that overlay on top of a tab's content */
type OverlayScreen = "editProfile" | "habitDetail" | "notifications" | "habits" | "addFriend";

/**
 * Extracts the username from a /@username URL path on web.
 * Returns null if the path doesn't match the pattern.
 * Regex aligned with auth service: ^[a-zA-Z0-9_-]{3,64}$
 */
function getPublicFlameUsername(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    const path = window.location.pathname;
    const match = path.match(/^\/@([a-zA-Z0-9_-]{3,64})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Root navigator that switches between auth and main app.
 *
 * Authenticated shell has a bottom tab bar with:
 *   Today | Friends | Feed | Profile
 *
 * Overlay screens (habit detail, notifications, edit profile, habits list)
 * render on top of the current tab.
 */
export function RootNavigator() {
  const auth = useAuth();
  const colors = lightTheme;
  const [activeTab, setActiveTab] = useState<TabId>("today");
  const [overlay, setOverlay] = useState<OverlayScreen | null>(null);
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [exitPublicFlame, setExitPublicFlame] = useState(false);
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);

  const unreadCount = useUnreadCount();

  const goToEditProfile = useCallback(() => setOverlay("editProfile"), []);
  const goToNotifications = useCallback(() => setOverlay("notifications"), []);
  const goToHabits = useCallback(() => setOverlay("habits"), []);
  const goToAddFriend = useCallback(() => setOverlay("addFriend"), []);
  const dismissOverlay = useCallback(() => setOverlay(null), []);

  const handleTabPress = useCallback((tabId: TabId) => {
    setOverlay(null);
    setActiveTab(tabId);
  }, []);

  const handleHabitPress = useCallback((habitId: string) => {
    setSelectedHabitId(habitId);
    setOverlay("habitDetail");
  }, []);

  const handleProfileCompletion = useCallback(() => {
    setProfileCompleted(true);
  }, []);

  const handlePublicFlameCta = useCallback(() => {
    setExitPublicFlame(true);
    if (Platform.OS === "web") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  // Public flame page: /@username route (web only, no auth required)
  const publicUsername = getPublicFlameUsername();
  if (publicUsername && !exitPublicFlame) {
    return (
      <>
        <PublicFlameScreen username={publicUsername} onNavigateToSignUp={handlePublicFlameCta} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (auth.status === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="loading-screen">
        <LoadingState message="Restoring your session..." />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <>
        <OfflineIndicator />
        <AuthNavigator />
        <StatusBar style="auto" />
      </>
    );
  }

  // First-login completion: prompt for display name if missing
  if (!auth.user.displayName && !profileCompleted) {
    return (
      <>
        <OfflineIndicator />
        <ProfileCompletionScreen onComplete={handleProfileCompletion} />
        <StatusBar style="auto" />
      </>
    );
  }

  // --- Overlay screens (render on top of tabs, no tab bar) ---

  if (overlay === "editProfile") {
    return (
      <>
        <OfflineIndicator />
        <EditProfileScreen onBack={() => { setOverlay(null); setActiveTab("profile"); }} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "habitDetail" && selectedHabitId) {
    return (
      <>
        <OfflineIndicator />
        <HabitDetailScreen habitId={selectedHabitId} onBack={dismissOverlay} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "notifications") {
    return (
      <>
        <OfflineIndicator />
        <NotificationScreen
          onUnreadCountChange={(delta) => unreadCount.decrementBy(-delta)}
          onMarkAllRead={() => unreadCount.resetToZero()}
          onMarkAllReadFailed={() => unreadCount.refresh()}
          onBack={dismissOverlay}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "habits") {
    return (
      <>
        <OfflineIndicator />
        <HabitListScreen />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "addFriend") {
    return (
      <>
        <OfflineIndicator />
        <AddFriendScreen
          currentUserId={auth.user.id}
          onBack={() => { setOverlay(null); setActiveTab("friends"); }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  // --- Tab content ---

  const tabs = [
    { id: "today" as TabId, label: "Today", icon: "\u2600\uFE0F" },
    { id: "friends" as TabId, label: "Friends", icon: "\uD83D\uDC65" },
    { id: "feed" as TabId, label: "Feed", icon: "\uD83D\uDCE3" },
    { id: "profile" as TabId, label: "Profile", icon: "\uD83D\uDC64" },
  ];

  let tabContent: React.ReactNode;

  switch (activeTab) {
    case "friends":
      tabContent = (
        <FriendsScreen
          onAddFriend={goToAddFriend}
          onFriendPress={(_friendId) => {
            // TODO: navigate to FriendProfileScreen (winzy.ai-ekw)
          }}
        />
      );
      break;
    case "feed":
      tabContent = (
        <View style={styles.center} testID="feed-tab-content">
          <EmptyState
            title="Activity feed coming soon"
            message="You'll see your friends' progress here."
            hideIllustration
          />
        </View>
      );
      break;
    case "profile":
      tabContent = (
        <ProfileScreen onEditProfile={goToEditProfile} onSettings={() => handleTabPress("today")} />
      );
      break;
    case "today":
    default:
      tabContent = (
        <TodayScreen
          onCreateHabit={goToHabits}
          onHabitPress={handleHabitPress}
          onNotifications={goToNotifications}
          unreadNotificationCount={unreadCount.count}
        />
      );
      break;
  }

  return (
    <>
      <OfflineIndicator />
      <View style={[styles.shell, { backgroundColor: colors.background }]} testID="app-shell">
        <View style={styles.content}>
          {tabContent}
        </View>
        <TabBar tabs={tabs} activeTab={activeTab} onTabPress={handleTabPress} />
      </View>
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  shell: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
  },
});
