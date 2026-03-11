import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { spacing } from "../design-system/tokens/spacing";
import { typography } from "../design-system/tokens/typography";
import { lightTheme } from "../design-system/tokens/colors";
import { Button } from "../design-system/components/Button";

type Props = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * React error boundary with an encouraging fallback UI.
 * Catches render errors in the subtree and shows a friendly recovery screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Structured log for debugging / E2E diagnostics
    console.error("[ErrorBoundary] Uncaught error:", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container} accessibilityRole="alert" testID="error-boundary-fallback">
          <Text style={styles.title}>Oops, something unexpected happened</Text>
          <Text style={styles.message}>
            {"Don't worry \u2014 your data is safe. Let's get you back on track."}
          </Text>
          <View style={styles.action}>
            <Button title="Try again" onPress={this.handleReset} variant="primary" size="md" />
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const colors = lightTheme;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
    backgroundColor: colors.background,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 320,
  },
  action: {
    marginTop: spacing.xl,
  },
});
