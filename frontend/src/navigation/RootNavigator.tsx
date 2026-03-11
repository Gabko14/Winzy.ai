import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { AuthNavigator } from "./AuthNavigator";
import { LoadingState } from "../design-system";
import { spacing, typography, lightTheme } from "../design-system";
import { StatusBar } from "expo-status-bar";
import { OfflineIndicator } from "../components/OfflineIndicator";

/**
 * Root navigator that switches between auth and main app.
 *
 * - loading: full-screen spinner while session bootstraps
 * - unauthenticated: auth navigator (sign in / sign up)
 * - authenticated: main app (placeholder until real screens land)
 */
export function RootNavigator() {
  const auth = useAuth();
  const colors = lightTheme;

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

  // Authenticated — placeholder until main app screens are built
  return (
    <>
      <OfflineIndicator />
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="main-app">
        <Text style={[styles.greeting, { color: colors.textPrimary }]}>
          {"Welcome, " + auth.user.username + "!"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Your habits dashboard is coming soon.
        </Text>
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
  greeting: {
    ...typography.h3,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
  },
});
