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
import { PublicFlameScreen } from "../screens/PublicFlameScreen";

type AppScreen = "home" | "habits" | "profile" | "editProfile";

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
 * - loading: full-screen spinner while session bootstraps
 * - unauthenticated: auth navigator (sign in / sign up)
 * - authenticated + no displayName: profile completion
 * - authenticated: main app with profile navigation
 */
export function RootNavigator() {
  const auth = useAuth();
  const colors = lightTheme;
  const [screen, setScreen] = useState<AppScreen>("home");
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [exitPublicFlame, setExitPublicFlame] = useState(false);

  const goToProfile = useCallback(() => setScreen("profile"), []);
  const goToEditProfile = useCallback(() => setScreen("editProfile"), []);
  const goToHome = useCallback(() => setScreen("home"), []);
  const goToHabits = useCallback(() => setScreen("habits"), []);

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

  // Profile screen
  if (screen === "profile") {
    return (
      <>
        <OfflineIndicator />
        <ProfileScreen onEditProfile={goToEditProfile} onSettings={goToHome} />
        <StatusBar style="auto" />
      </>
    );
  }

  // Edit profile screen
  if (screen === "editProfile") {
    return (
      <>
        <OfflineIndicator />
        <EditProfileScreen onBack={goToProfile} />
        <StatusBar style="auto" />
      </>
    );
  }

  // Habits management screen
  if (screen === "habits") {
    return (
      <>
        <OfflineIndicator />
        <HabitListScreen />
        <StatusBar style="auto" />
      </>
    );
  }

  // Authenticated — Today screen (daily habit dashboard)
  return (
    <>
      <OfflineIndicator />
      <TodayScreen onCreateHabit={goToHabits} />
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
});
