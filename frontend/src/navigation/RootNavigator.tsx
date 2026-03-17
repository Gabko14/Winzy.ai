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
import type { Habit } from "../api/habits";
import { useVisibility } from "../hooks/useVisibility";
import { useUnreadCount } from "../hooks/useUnreadCount";
import { usePendingFriendCount } from "../hooks/usePendingFriendCount";
import { useOnboarding } from "../hooks/useOnboarding";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { FlameIntroModal } from "../screens/FlameIntroModal";
import { TabBar, type TabId } from "./TabBar";
import { useChallengeCompletion } from "../hooks/useChallengeCompletion";
import { ChallengeCompletionOverlay } from "../components/ChallengeCompletionOverlay";

/** Screens that overlay on top of a tab's content */
type OverlayScreen = "editProfile" | "habitDetail" | "editHabit" | "notifications" | "habits" | "addFriend" | "friendProfile" | "createChallenge" | "challenges" | "settings" | "stats";

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
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedFriendName, setSelectedFriendName] = useState<string | null>(null);
  const [editHabitData, setEditHabitData] = useState<Habit | null>(null);

  const unreadCount = useUnreadCount();
  const pendingFriendCount = usePendingFriendCount();
  const onboarding = useOnboarding();
  const visibility = useVisibility();
  const challengeCompletion = useChallengeCompletion();
  const [showFlameIntro, setShowFlameIntro] = useState(false);

  const goToEditProfile = useCallback(() => setOverlay("editProfile"), []);
  const goToNotifications = useCallback(() => setOverlay("notifications"), []);
  const goToHabits = useCallback(() => setOverlay("habits"), []);
  const goToAddFriend = useCallback(() => setOverlay("addFriend"), []);
  const goToSettings = useCallback(() => setOverlay("settings"), []);
  const handleEditHabit = useCallback(async (habitId: string) => {
    try {
      const habit = await fetchHabit(habitId);
      setEditHabitData(habit);
      setOverlay("editHabit");
    } catch {
      // Fetch failed — stay on detail screen, user can retry
    }
  }, []);
  const handleSetChallenge = useCallback((fId: string, fName: string) => {
    setSelectedFriendId(fId);
    setSelectedFriendName(fName);
    setOverlay("createChallenge");
  }, []);
  const dismissOverlay = useCallback(() => setOverlay(null), []);

  const handleTabPress = useCallback((tabId: TabId) => {
    setOverlay(null);
    setActiveTab(tabId);
  }, []);

  const handleHabitPress = useCallback((habitId: string) => {
    setSelectedHabitId(habitId);
    setOverlay("habitDetail");
  }, []);

  const handleViewStats = useCallback((habitId: string) => {
    setSelectedHabitId(habitId);
    setOverlay("stats");
  }, []);

  const handleFriendPress = useCallback((friendId: string) => {
    setSelectedFriendId(friendId);
    setOverlay("friendProfile");
  }, []);


  const handleNotificationPress = useCallback((notification: NotificationItem) => {
    const { type, data } = notification;
    // friendrequestsent uses fromUserId, friendrequestaccepted uses otherUserId
    const targetUserId = (data.fromUserId ?? data.otherUserId) as string | undefined;

    switch (type) {
      case "friendrequestsent":
      case "friendrequestaccepted":
        if (targetUserId) {
          setSelectedFriendId(targetUserId);
          setOverlay("friendProfile");
        }
        break;
      case "challengecreated":
        setOverlay("challenges");
        break;
      case "challengecompleted":
        challengeCompletion.triggerCheck();
        break;
    }
  }, [challengeCompletion]);
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
        <HabitDetailScreen
          habitId={selectedHabitId}
          onBack={dismissOverlay}
          onViewStats={handleViewStats}
          onEdit={handleEditHabit}
          onArchive={async (habitId: string) => {
            try {
              await archiveHabit(habitId);
              dismissOverlay();
            } catch {
              // Archive failed — stay on detail screen so user can retry
            }
          }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "editHabit" && editHabitData) {
    return (
      <>
        <OfflineIndicator />
        <CreateHabitScreen
          visible
          onClose={() => {
            setEditHabitData(null);
            setOverlay("habitDetail");
          }}
          onSaved={() => {
            setEditHabitData(null);
            setOverlay("habitDetail");
          }}
          editHabit={editHabitData}
          editVisibility={visibility.getVisibility(editHabitData.id)}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "notifications") {
    return (
      <>
        <OfflineIndicator />
        <NotificationScreen
          onNotificationPress={handleNotificationPress}
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
        <HabitListScreen
          onBack={dismissOverlay}
          onHabitCreated={() => {
            if (!onboarding.hasSeenFlameIntro) {
              setShowFlameIntro(true);
            }
          }}
        />
        <FlameIntroModal
          visible={showFlameIntro}
          onDismiss={() => {
            setShowFlameIntro(false);
            onboarding.markFlameIntroSeen();
          }}
        />
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

  if (overlay === "friendProfile" && selectedFriendId) {
    // displayName/username/since not passed — onFriendPress only receives friendId.
    // Brief placeholder flash until API responds. Acceptable; enrichment is a separate concern.
    return (
      <>
        <OfflineIndicator />
        <FriendProfileScreen
          friendId={selectedFriendId}
          onBack={() => { setOverlay(null); setActiveTab("friends"); }}
          onSetChallenge={handleSetChallenge}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "createChallenge" && selectedFriendId) {
    return (
      <>
        <OfflineIndicator />
        <CreateChallengeScreen
          friendId={selectedFriendId}
          friendName={selectedFriendName ?? undefined}
          onBack={() => { setOverlay("friendProfile"); }}
          onComplete={() => { setOverlay(null); setActiveTab("friends"); }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "challenges") {
    return (
      <>
        <OfflineIndicator />
        <MyChallengesScreen onBack={dismissOverlay} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (overlay === "settings") {
    return (
      <>
        <OfflineIndicator />
        <SettingsScreen
          onBack={() => { setOverlay(null); setActiveTab("profile"); }}
          onEditProfile={goToEditProfile}
        />
        <StatusBar style="auto" />
      </>
    );
  }


  if (overlay === "stats" && selectedHabitId) {
    return (
      <>
        <OfflineIndicator />
        <StatsScreen habitId={selectedHabitId} onBack={() => { setSelectedHabitId(selectedHabitId); setOverlay("habitDetail"); }} />
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
            setOverlay("challenges");
          }}
        />
      );
      break;
    case "profile":
      tabContent = (
        <ProfileScreen onEditProfile={goToEditProfile} onSettings={goToSettings} onChallenges={() => setOverlay("challenges")} />
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
