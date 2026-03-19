import React, { useCallback, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { AuthNavigator } from "./AuthNavigator";
import { LoadingState } from "../design-system";
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
import type { NotificationItem } from "../api/notifications";
import { FriendsScreen } from "../screens/FriendsScreen";
import { AddFriendScreen } from "../screens/AddFriendScreen";
import { FriendProfileScreen } from "../screens/FriendProfileScreen";
import { CreateChallengeScreen } from "../screens/CreateChallengeScreen";
import { FeedScreen } from "../screens/FeedScreen";
import { StatsScreen } from "../screens/StatsScreen";
import { CreateHabitScreen } from "../screens/CreateHabitScreen";
import { MyChallengesScreen } from "../screens/MyChallengesScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { fetchHabit, archiveHabit } from "../api/habits";
import { useVisibility } from "../hooks/useVisibility";
import { useUnreadCount } from "../hooks/useUnreadCount";
import { usePendingFriendCount } from "../hooks/usePendingFriendCount";
import { useOnboarding } from "../hooks/useOnboarding";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { FlameIntroModal } from "../screens/FlameIntroModal";
import { TabBar, type TabId } from "./TabBar";
import { useChallengeCompletion } from "../hooks/useChallengeCompletion";
import { ChallengeCompletionOverlay } from "../components/ChallengeCompletionOverlay";
import { useOverlayRouter } from "./useOverlayRouter";

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
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [exitPublicFlame, setExitPublicFlame] = useState(false);
  const overlay = useOverlayRouter();

  const isAuthenticated = auth.status === "authenticated";
  const unreadCount = useUnreadCount(isAuthenticated);
  const pendingFriendCount = usePendingFriendCount(isAuthenticated);
  const onboarding = useOnboarding(isAuthenticated ? auth.user.id : "");
  const visibility = useVisibility(isAuthenticated);
  const challengeCompletion = useChallengeCompletion(isAuthenticated);
  const [showFlameIntro, setShowFlameIntro] = useState(false);

  const goToEditProfile = useCallback(() => overlay.push("editProfile"), [overlay]);
  const goToNotifications = useCallback(() => overlay.push("notifications"), [overlay]);
  const goToHabits = useCallback(() => overlay.push("habits"), [overlay]);
  const goToAddFriend = useCallback(() => overlay.push("addFriend"), [overlay]);
  const goToSettings = useCallback(() => overlay.push("settings"), [overlay]);
  const handleEditHabit = useCallback(async (habitId: string) => {
    try {
      const habit = await fetchHabit(habitId);
      overlay.push("editHabit", { editHabitData: habit });
    } catch {
      // Fetch failed — stay on detail screen, user can retry
    }
  }, [overlay]);
  const handleSetChallenge = useCallback((fId: string, fName: string) => {
    overlay.push("createChallenge", { friendId: fId, friendName: fName });
  }, [overlay]);

  const handleTabPress = useCallback((tabId: TabId) => {
    overlay.closeAll();
    setActiveTab(tabId);
  }, [overlay]);

  const handleHabitPress = useCallback((habitId: string) => {
    overlay.push("habitDetail", { habitId });
  }, [overlay]);

  const handleViewStats = useCallback((habitId: string) => {
    overlay.push("stats", { habitId });
  }, [overlay]);

  const handleFriendPress = useCallback((friendId: string) => {
    overlay.push("friendProfile", { friendId });
  }, [overlay]);

  const handleNotificationPress = useCallback((notification: NotificationItem) => {
    const { type, data } = notification;
    // friendrequestsent uses fromUserId, friendrequestaccepted uses otherUserId
    const targetUserId = (data.fromUserId ?? data.otherUserId) as string | undefined;

    switch (type) {
      case "friendrequestsent":
      case "friendrequestaccepted":
        if (targetUserId) {
          overlay.push("friendProfile", { friendId: targetUserId });
        }
        break;
      case "habitcompleted":
        if (data.fromUserId) {
          overlay.push("friendProfile", { friendId: data.fromUserId as string });
        }
        break;
      case "challengecreated":
        overlay.push("challenges");
        break;
      case "challengecompleted":
        challengeCompletion.triggerCheck();
        break;
    }
  }, [challengeCompletion.triggerCheck, overlay]);
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

  // Wait for onboarding state to load before deciding what to show
  if (onboarding.loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="loading-screen">
        <LoadingState message="Restoring your session..." />
        <StatusBar style="auto" />
      </View>
    );
  }

  // Welcome screen for first-time users (after profile completion)
  if (!onboarding.hasSeenWelcome) {
    return (
      <>
        <OfflineIndicator />
        <WelcomeScreen onContinue={onboarding.markWelcomeSeen} />
        <StatusBar style="auto" />
      </>
    );
  }

  // --- Overlay screens (render on top of tabs, no tab bar) ---

  if (overlay.current === "editProfile") {
    return (
      <>
        <OfflineIndicator />
        <EditProfileScreen onBack={() => { overlay.closeAll(); setActiveTab("profile"); }} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "habitDetail" && overlay.params.habitId) {
    return (
      <>
        <OfflineIndicator />
        <HabitDetailScreen
          habitId={overlay.params.habitId}
          onBack={overlay.closeAll}
          onViewStats={handleViewStats}
          onEdit={handleEditHabit}
          onArchive={async (habitId: string) => {
            try {
              await archiveHabit(habitId);
              overlay.closeAll();
            } catch {
              // Archive failed — stay on detail screen so user can retry
            }
          }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "editHabit" && overlay.params.editHabitData) {
    const editHabitData = overlay.params.editHabitData;
    return (
      <>
        <OfflineIndicator />
        <CreateHabitScreen
          visible
          onClose={() => {
            overlay.pop();
          }}
          onSaved={() => {
            overlay.pop();
          }}
          editHabit={editHabitData}
          editVisibility={visibility.getVisibility(editHabitData.id)}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "notifications") {
    return (
      <>
        <OfflineIndicator />
        <NotificationScreen
          onNotificationPress={handleNotificationPress}
          onUnreadCountChange={(delta) => unreadCount.decrementBy(-delta)}
          onMarkAllRead={() => unreadCount.resetToZero()}
          onMarkAllReadFailed={() => unreadCount.refresh()}
          onBack={overlay.closeAll}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "habits") {
    return (
      <>
        <OfflineIndicator />
        <HabitListScreen
          onBack={overlay.closeAll}
          onHabitCreated={() => {
            if (!onboarding.hasSeenFlameIntro) {
              // First habit: return to daily loop and show flame intro
              overlay.closeAll();
              setActiveTab("today");
              setShowFlameIntro(true);
            }
            // Returning users stay on HabitListScreen
          }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "addFriend") {
    return (
      <>
        <OfflineIndicator />
        <AddFriendScreen
          currentUserId={auth.user.id}
          onBack={() => { overlay.closeAll(); setActiveTab("friends"); }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "friendProfile" && overlay.params.friendId) {
    // displayName/username/since not passed — onFriendPress only receives friendId.
    // Brief placeholder flash until API responds. Acceptable; enrichment is a separate concern.
    return (
      <>
        <OfflineIndicator />
        <FriendProfileScreen
          friendId={overlay.params.friendId}
          onBack={() => { overlay.closeAll(); setActiveTab("friends"); }}
          onSetChallenge={handleSetChallenge}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "createChallenge" && overlay.params.friendId) {
    return (
      <>
        <OfflineIndicator />
        <CreateChallengeScreen
          friendId={overlay.params.friendId}
          friendName={overlay.params.friendName ?? undefined}
          onBack={() => { overlay.pop(); }}
          onComplete={() => { overlay.closeAll(); setActiveTab("friends"); }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "challenges") {
    return (
      <>
        <OfflineIndicator />
        <MyChallengesScreen onBack={overlay.closeAll} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "settings") {
    return (
      <>
        <OfflineIndicator />
        <SettingsScreen
          onBack={() => { overlay.closeAll(); setActiveTab("profile"); }}
          onEditProfile={goToEditProfile}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay.current === "stats" && overlay.params.habitId) {
    return (
      <>
        <OfflineIndicator />
        <StatsScreen habitId={overlay.params.habitId} onBack={() => { overlay.pop(); }} />
        <StatusBar style="auto" />
      </>
    );
  }

  // --- Tab content ---

  const tabs = [
    { id: "today" as TabId, label: "Today", icon: "\u2600\uFE0F" },
    { id: "friends" as TabId, label: "Friends", icon: "\uD83D\uDC65", badge: pendingFriendCount.count },
    { id: "feed" as TabId, label: "Feed", icon: "\uD83D\uDCE3" },
    { id: "profile" as TabId, label: "Profile", icon: "\uD83D\uDC64" },
  ];

  let tabContent: React.ReactNode;

  switch (activeTab) {
    case "friends":
      tabContent = (
        <FriendsScreen
          onAddFriend={goToAddFriend}
          onFriendPress={handleFriendPress}
        />
      );
      break;
    case "feed":
      tabContent = (
        <FeedScreen
          onAvatarPress={handleFriendPress}
          onChallengePress={() => {
            overlay.push("challenges");
          }}
        />
      );
      break;
    case "profile":
      tabContent = (
        <ProfileScreen onEditProfile={goToEditProfile} onSettings={goToSettings} onChallenges={() => overlay.push("challenges")} />
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
      <FlameIntroModal
        visible={showFlameIntro}
        onDismiss={() => {
          setShowFlameIntro(false);
          onboarding.markFlameIntroSeen();
        }}
      />
      {challengeCompletion.current && (
        <ChallengeCompletionOverlay
          challenge={challengeCompletion.current}
          claiming={challengeCompletion.claiming}
          claimError={challengeCompletion.claimError}
          remainingCount={challengeCompletion.remainingCount}
          onClaim={challengeCompletion.claim}
          onDismiss={challengeCompletion.dismiss}
        />
      )}
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
