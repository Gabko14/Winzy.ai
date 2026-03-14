import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Button, Flame, FadeIn } from "../design-system";
import { spacing, typography, lightTheme } from "../design-system";

type Props = {
  onContinue: () => void;
};

export function WelcomeScreen({ onContinue }: Props) {
  const colors = lightTheme;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="welcome-screen">
      <FadeIn>
        <View style={styles.content}>
          <View style={styles.flameContainer}>
            <Flame flameLevel="ember" size="lg" />
          </View>

          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Welcome to Winzy
          </Text>

          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Build habits that stick. Track your consistency and watch your flame grow.
          </Text>

          <View style={styles.action}>
            <Button
              title="Let's go"
              onPress={onContinue}
              size="lg"
              accessibilityLabel="Continue to the app"
            />
          </View>
        </View>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing["3xl"],
  },
  content: {
    alignItems: "center",
    maxWidth: 360,
    width: "100%",
  },
  flameContainer: {
    marginBottom: spacing["2xl"],
  },
  title: {
    ...typography.h2,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
    marginBottom: spacing["3xl"],
  },
  action: {
    width: "100%",
  },
});
