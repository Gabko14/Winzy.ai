import React from "react";
import { StatusBar } from "expo-status-bar";
import { OfflineIndicator } from "./OfflineIndicator";
import { ErrorBoundary } from "./ErrorBoundary";

export type OverlayShellProps = {
  children: React.ReactNode;
};

/**
 * Standard wrapper for overlay screens in RootNavigator.
 * Composes OfflineIndicator + ErrorBoundary + StatusBar.
 */
export function OverlayShell({ children }: OverlayShellProps) {
  return (
    <>
      <OfflineIndicator />
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
      <StatusBar style="auto" />
    </>
  );
}
