import React, { useCallback, useState } from "react";
import { SignInScreen } from "../screens/SignInScreen";
import { SignUpScreen } from "../screens/SignUpScreen";

type AuthScreen = "signIn" | "signUp";

/**
 * Auth navigation stack. Toggles between Sign In and Sign Up.
 *
 * No external router needed for two screens. When proper navigation
 * lands (habits, profile, etc.), this can be replaced with a real stack navigator.
 */
export function AuthNavigator() {
  const [screen, setScreen] = useState<AuthScreen>("signIn");

  const goToSignUp = useCallback(() => setScreen("signUp"), []);
  const goToSignIn = useCallback(() => setScreen("signIn"), []);

  if (screen === "signUp") {
    return <SignUpScreen onNavigateToSignIn={goToSignIn} />;
  }

  return <SignInScreen onNavigateToSignUp={goToSignUp} />;
}
