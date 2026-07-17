import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { AuthNavigator } from "./AuthNavigator";
import { LoadingState } from "../design-system";
import { spacing, lightTheme, typography } from "../design-system";
import { StatusBar } from "expo-status-bar";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { ProfileCompletionScreen } from "../screens/ProfileCompletionScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { EditProfileScreen } from "../screens/EditProfileScreen";
import { TodayScreen } from "../screens/TodayScreen";
import { HabitDetailScreen } from "../screens/HabitDetailScreen";
import { PublicFlameScreen } from "../screens/PublicFlameScreen";
import { NotificationScreen } from "../components/notifications";
import type { NotificationItem } from "../api/notifications";
import { FriendsScreen } from "../screens/FriendsScreen";
import { AddFriendScreen } from "../screens/AddFriendScreen";
import { FriendProfileScreen } from "../screens/FriendProfileScreen";
import { CreateChallengeScreen } from "../screens/CreateChallengeScreen";
import { CreateChallengeInviteScreen } from "../screens/CreateChallengeInviteScreen";
import { ChallengeInviteScreen } from "../screens/ChallengeInviteScreen";
import { FeedScreen } from "../screens/FeedScreen";
import { StatsScreen } from "../screens/StatsScreen";
import { CreateHabitScreen } from "../screens/CreateHabitScreen";
import { MyChallengesScreen } from "../screens/MyChallengesScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { WitnessLinksScreen } from "../screens/WitnessLinksScreen";
import { WitnessViewerScreen } from "../screens/WitnessViewerScreen";
import { TodosManageScreen } from "../screens/TodosManageScreen";
import { MeditationScreen } from "../screens/MeditationScreen";
import { fetchHabit, archiveHabit } from "../api/habits";
import { claimChallengeInvite } from "../api/challenges";
import { queryKeys } from "../api/queryKeys";
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
import { useHistorySync } from "./useHistorySync";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { OverlayShell } from "../components/OverlayShell";
import { subscribeNotificationNavigation } from "../pwa/notificationClicks";
import {
  clearPendingChallengeInviteToken,
  getPendingChallengeInviteToken,
} from "../utils/challengeInviteToken";
import { kindMessageForClaimError } from "../hooks/useChallengeInviteClaim";
import { isApiError } from "../api/types";

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
 * Extracts the witness token from a /w/{token} URL path on web.
 * Returns null if the path doesn't match the pattern.
 * Tokens are 43-char base64url strings (32 bytes).
 */
function getWitnessToken(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    const path = window.location.pathname;
    const match = path.match(/^\/w\/([A-Za-z0-9_-]{20,64})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the challenge-invite token from a /ci/{token} URL path on web.
 * Returns null if the path doesn't match the pattern.
 * Tokens are 43-char base64url strings (32 bytes), same family as witness tokens.
 */
function getChallengeInviteToken(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    const path = window.location.pathname;
    const match = path.match(/^\/ci\/([A-Za-z0-9_-]{20,64})$/);
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
 * Overlay screens (habit detail, notifications, edit profile, create habit)
 * render on top of the current tab.
 */
export function RootNavigator() {
  const auth = useAuth();
  const colors = lightTheme;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("today");
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [exitPublicFlame, setExitPublicFlame] = useState(false);
  const [exitWitnessView, setExitWitnessView] = useState(false);
  const [exitChallengeInvite, setExitChallengeInvite] = useState(false);
  const [inviteBanner, setInviteBanner] = useState<string | null>(null);
  const [claimingPendingInvite, setClaimingPendingInvite] = useState(false);
  const pendingClaimStartedRef = useRef<string | null>(null);

  const applyPopRef = useRef<() => void>(() => {});
  const setActiveTabRef = useRef<(tab: TabId) => void>(() => {});

  const witnessTokenForHistory = getWitnessToken();
  const publicUsernameForHistory = getPublicFlameUsername();
  const challengeInviteTokenForHistory = getChallengeInviteToken();
  const historyEnabled =
    Platform.OS === "web" &&
    auth.status === "authenticated" &&
    !(witnessTokenForHistory && !exitWitnessView) &&
    !(publicUsernameForHistory && !exitPublicFlame) &&
    !(challengeInviteTokenForHistory && !exitChallengeInvite);

  const historySync = useHistorySync({
    enabled: historyEnabled,
    applyOverlayPop: () => applyPopRef.current(),
    applyReturnToToday: () => setActiveTabRef.current("today"),
  });

  const overlay = useOverlayRouter({
    onAfterPush: () => historySync.onOverlayPushed(),
    interceptPop: () => historySync.interceptOverlayPop(),
    beforeCloseAll: (depth) => historySync.beforeOverlayCloseAll(depth),
  });

  applyPopRef.current = overlay.applyPop;
  setActiveTabRef.current = setActiveTab;

  const isAuthenticated = auth.status === "authenticated";
  const unreadCount = useUnreadCount(isAuthenticated);
  const pendingFriendCount = usePendingFriendCount(isAuthenticated);
  const onboarding = useOnboarding(isAuthenticated ? auth.user.id : "");
  const visibility = useVisibility(isAuthenticated);
  const challengeCompletion = useChallengeCompletion(isAuthenticated);
  const [showFlameIntro, setShowFlameIntro] = useState(false);

  const goToEditProfile = useCallback(() => overlay.push("editProfile"), [overlay]);
  const goToNotifications = useCallback(() => overlay.push("notifications"), [overlay]);
  const goToCreateHabit = useCallback(() => overlay.push("createHabit"), [overlay]);
  const goToMeditation = useCallback(() => overlay.push("meditation"), [overlay]);
  const goToAddFriend = useCallback(() => overlay.push("addFriend"), [overlay]);
  const goToChallengeInvite = useCallback(() => overlay.push("createChallengeInvite"), [overlay]);
  const goToSettings = useCallback(() => overlay.push("settings"), [overlay]);
  const goToWitnessLinks = useCallback(() => overlay.push("witnessLinks"), [overlay]);
  const goToTodos = useCallback(() => overlay.push("todos"), [overlay]);
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

  const selectTab = useCallback((tabId: TabId) => {
    historySync.syncTabChange(activeTab, tabId);
    setActiveTab(tabId);
  }, [historySync, activeTab]);

  const selectTabNavRef = useRef(selectTab);
  selectTabNavRef.current = selectTab;
  const overlayNavRef = useRef(overlay);
  overlayNavRef.current = overlay;

  useEffect(() => {
    if (!isAuthenticated) return;
    return subscribeNotificationNavigation((dest) => {
      overlayNavRef.current.closeAll();
      if (dest.kind === "tab") {
        selectTabNavRef.current(dest.tab);
        return;
      }
      overlayNavRef.current.push(dest.overlay);
    });
  }, [isAuthenticated]);

  const handleTabPress = useCallback((tabId: TabId) => {
    overlay.closeAll();
    selectTab(tabId);
  }, [overlay, selectTab]);

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
      case "challengeaccepted":
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

  const handleWitnessViewCta = useCallback(() => {
    setExitWitnessView(true);
    if (Platform.OS === "web") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const handleChallengeInviteCta = useCallback(() => {
    setExitChallengeInvite(true);
    if (Platform.OS === "web") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const handleChallengeInviteAccepted = useCallback((habitName: string) => {
    clearPendingChallengeInviteToken();
    setExitChallengeInvite(true);
    if (Platform.OS === "web") {
      window.history.replaceState(null, "", "/");
    }
    setActiveTab("today");
    setInviteBanner(`Challenge accepted — "${habitName}" is ready on Today.`);
  }, []);

  // After signup/login with a persisted invite token, claim once then land on Today.
  // Wait until profile + welcome are done so the user arrives on the main shell.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onLanding = !!(getChallengeInviteToken() && !exitChallengeInvite);
    if (onLanding) return;
    if (!auth.user.displayName && !profileCompleted) return;
    if (onboarding.loading || !onboarding.hasSeenWelcome) return;

    const token = getPendingChallengeInviteToken();
    if (!token) return;
    if (pendingClaimStartedRef.current === token) return;
    pendingClaimStartedRef.current = token;

    let cancelled = false;
    setClaimingPendingInvite(true);

    void (async () => {
      try {
        await claimChallengeInvite(token);
        if (cancelled) return;
        clearPendingChallengeInviteToken();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.challenges.list() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.challenges.invites() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.friends.list() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.friends.pendingCount() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() }),
        ]);
        setActiveTab("today");
        setInviteBanner("Challenge accepted — your new habit is ready on Today.");
      } catch (err) {
        if (cancelled) return;
        clearPendingChallengeInviteToken();
        setInviteBanner(
          kindMessageForClaimError(isApiError(err) ? err : null),
        );
      } finally {
        if (!cancelled) setClaimingPendingInvite(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isAuthenticated,
    exitChallengeInvite,
    queryClient,
    profileCompleted,
    onboarding.loading,
    onboarding.hasSeenWelcome,
    auth.status === "authenticated" ? auth.user.displayName : null,
  ]);

  // Challenge invite landing: /ci/{token} (web only; auth optional)
  const challengeInviteToken = getChallengeInviteToken();
  if (challengeInviteToken && !exitChallengeInvite) {
    return (
      <>
        <ChallengeInviteScreen
          token={challengeInviteToken}
          isAuthenticated={isAuthenticated}
          onNavigateToSignUp={handleChallengeInviteCta}
          onAccepted={handleChallengeInviteAccepted}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  // Witness viewer: /w/{token} route (web only, no auth required)
  const witnessToken = getWitnessToken();
  if (witnessToken && !exitWitnessView) {
    return (
      <>
        <WitnessViewerScreen token={witnessToken} onNavigateToSignUp={handleWitnessViewCta} />
        <StatusBar style="auto" />
      </>
    );
  }

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

  if (claimingPendingInvite) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="claiming-invite-screen">
        <LoadingState message="Accepting your challenge..." />
        <StatusBar style="auto" />
      </View>
    );
  }

  // --- Overlay screens (render on top of tabs, no tab bar) ---

  if (overlay.current === "editProfile") {
    return (
      <OverlayShell>
        <EditProfileScreen onBack={() => { overlay.closeAll(); selectTab("profile"); }} />
      </OverlayShell>
    );
  }

  if (overlay.current === "habitDetail" && overlay.params.habitId) {
    return (
      <OverlayShell>
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
      </OverlayShell>
    );
  }

  if (overlay.current === "editHabit" && overlay.params.editHabitData) {
    const editHabitData = overlay.params.editHabitData;
    return (
      <OverlayShell>
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
      </OverlayShell>
    );
  }

  if (overlay.current === "notifications") {
    return (
      <OverlayShell>
        <NotificationScreen
          onNotificationPress={handleNotificationPress}
          onUnreadCountChange={(delta) => unreadCount.decrementBy(-delta)}
          onMarkAllRead={() => unreadCount.resetToZero()}
          onMarkAllReadFailed={() => unreadCount.refresh()}
          onBack={overlay.closeAll}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "createHabit") {
    return (
      <OverlayShell>
        <CreateHabitScreen
          visible
          onClose={() => {
            overlay.pop();
          }}
          onSaved={() => {
            if (!onboarding.hasSeenFlameIntro) {
              overlay.closeAll();
              selectTab("today");
              setShowFlameIntro(true);
            } else {
              overlay.closeAll();
            }
          }}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "addFriend") {
    return (
      <OverlayShell>
        <AddFriendScreen
          currentUserId={auth.user.id}
          onBack={() => { overlay.closeAll(); selectTab("friends"); }}
          onChallengeInvite={goToChallengeInvite}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "friendProfile" && overlay.params.friendId) {
    // displayName/username/since not passed — onFriendPress only receives friendId.
    // Brief placeholder flash until API responds. Acceptable; enrichment is a separate concern.
    return (
      <OverlayShell>
        <FriendProfileScreen
          friendId={overlay.params.friendId}
          onBack={() => { overlay.closeAll(); selectTab("friends"); }}
          onSetChallenge={handleSetChallenge}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "createChallenge" && overlay.params.friendId) {
    return (
      <OverlayShell>
        <CreateChallengeScreen
          friendId={overlay.params.friendId}
          friendName={overlay.params.friendName ?? undefined}
          onBack={() => { overlay.pop(); }}
          onComplete={() => { overlay.closeAll(); selectTab("friends"); }}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "createChallengeInvite") {
    return (
      <OverlayShell>
        <CreateChallengeInviteScreen
          onBack={() => { overlay.pop(); }}
          onComplete={() => { overlay.closeAll(); selectTab("friends"); }}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "challenges") {
    return (
      <OverlayShell>
        <MyChallengesScreen onBack={overlay.closeAll} />
      </OverlayShell>
    );
  }

  if (overlay.current === "settings") {
    return (
      <OverlayShell>
        <SettingsScreen
          onBack={() => { overlay.closeAll(); selectTab("profile"); }}
          onEditProfile={goToEditProfile}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "witnessLinks") {
    return (
      <OverlayShell>
        <WitnessLinksScreen
          onBack={() => { overlay.closeAll(); selectTab("profile"); }}
        />
      </OverlayShell>
    );
  }

  if (overlay.current === "todos") {
    return (
      <OverlayShell>
        <TodosManageScreen onBack={overlay.closeAll} />
      </OverlayShell>
    );
  }

  if (overlay.current === "meditation") {
    return (
      <OverlayShell>
        <MeditationScreen onClose={overlay.closeAll} />
      </OverlayShell>
    );
  }

  if (overlay.current === "stats" && overlay.params.habitId) {
    return (
      <OverlayShell>
        <StatsScreen habitId={overlay.params.habitId} onBack={() => { overlay.pop(); }} />
      </OverlayShell>
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
        <ErrorBoundary>
          <FriendsScreen
            onAddFriend={goToAddFriend}
            onFriendPress={handleFriendPress}
          />
        </ErrorBoundary>
      );
      break;
    case "feed":
      tabContent = (
        <ErrorBoundary>
          <FeedScreen
            onAvatarPress={handleFriendPress}
            onChallengePress={() => {
              overlay.push("challenges");
            }}
          />
        </ErrorBoundary>
      );
      break;
    case "profile":
      tabContent = (
        <ErrorBoundary>
          <ProfileScreen onEditProfile={goToEditProfile} onSettings={goToSettings} onChallenges={() => overlay.push("challenges")} onWitnessLinks={goToWitnessLinks} />
        </ErrorBoundary>
      );
      break;
    case "today":
    default:
      tabContent = (
        <ErrorBoundary>
          <TodayScreen
            onCreateHabit={goToCreateHabit}
            onHabitPress={handleHabitPress}
            onNotifications={goToNotifications}
            onMeditation={goToMeditation}
            onManageTodos={goToTodos}
            unreadNotificationCount={unreadCount.count}
          />
        </ErrorBoundary>
      );
      break;
  }

  return (
    <>
      <OfflineIndicator />
      {inviteBanner && (
        <View
          style={[styles.inviteBanner, { backgroundColor: colors.brandPrimary }]}
          testID="invite-claim-banner"
        >
          <Text style={[styles.inviteBannerText, { color: colors.textInverse }]}>{inviteBanner}</Text>
          <Pressable
            onPress={() => setInviteBanner(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            testID="dismiss-invite-banner"
          >
            <Text style={[styles.inviteBannerDismiss, { color: colors.textInverse }]}>{"\u2715"}</Text>
          </Pressable>
        </View>
      )}
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
  inviteBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  inviteBannerText: {
    ...typography.bodySmall,
    flex: 1,
  },
  inviteBannerDismiss: {
    fontSize: 16,
    padding: spacing.xs,
  },
});
