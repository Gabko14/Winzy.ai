import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPushPlatform,
  getPushPermissionStatus,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  hasActiveWebPushSubscription,
  type PushPlatform,
} from "../utils/push";

export type PushStatus =
  | "loading"
  | "subscribed"
  | "unsubscribed"
  | "denied"
  | "unsupported";

type PushNotificationsState = {
  status: PushStatus;
  platform: PushPlatform;
  subscribing: boolean;
  error: string | null;
};

/**
 * Hook for managing push notification subscription lifecycle.
 *
 * Provides:
 * - Current push status (subscribed, unsubscribed, denied, unsupported)
 * - Platform detection (web_push, expo_push, unsupported)
 * - Subscribe/unsubscribe actions
 */
export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationsState>({
    status: "loading",
    platform: "unsupported",
    subscribing: false,
    error: null,
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Check current push state on mount
  useEffect(() => {
    async function checkStatus() {
      const platform = getPushPlatform();

      if (platform === "unsupported") {
        if (mountedRef.current) {
          setState({ status: "unsupported", platform, subscribing: false, error: null });
        }
        return;
      }

      if (platform === "web_push") {
        const permission = getPushPermissionStatus();
        if (permission === "denied") {
          if (mountedRef.current) {
            setState({ status: "denied", platform, subscribing: false, error: null });
          }
          return;
        }

        const hasSubscription = await hasActiveWebPushSubscription();
        if (mountedRef.current) {
          setState({
            status: hasSubscription ? "subscribed" : "unsubscribed",
            platform,
            subscribing: false,
            error: null,
          });
        }
        return;
      }

      // expo_push: not yet implemented
      if (mountedRef.current) {
        setState({ status: "unsupported", platform, subscribing: false, error: null });
      }
    }

    checkStatus();
  }, []);

  const subscribe = useCallback(async () => {
    if (state.platform !== "web_push" || state.subscribing) return;

    setState((s) => ({ ...s, subscribing: true, error: null }));

    try {
      const deviceId = await subscribeToWebPush(() => {
        // Permission denied callback
        if (mountedRef.current) {
          setState((s) => ({ ...s, status: "denied", subscribing: false, error: null }));
        }
      });

      if (!mountedRef.current) return;

      if (deviceId) {
        setState((s) => ({ ...s, status: "subscribed", subscribing: false, error: null }));
      } else {
        // Use functional updater to read current status — the onPermissionDenied
        // callback may have already set status to "denied" via setState.
        setState((s) => ({
          ...s,
          status: s.status === "denied" ? "denied" : "unsubscribed",
          subscribing: false,
          error: s.status === "denied" ? null : "Failed to enable push notifications. Please try again.",
        }));
      }
    } catch {
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          subscribing: false,
          error: "Failed to enable push notifications. Please try again.",
        }));
      }
    }
  }, [state.platform, state.subscribing]);

  const unsubscribe = useCallback(async () => {
    if (state.platform !== "web_push") return;

    setState((s) => ({ ...s, error: null }));
    const success = await unsubscribeFromWebPush();
    if (!mountedRef.current) return;

    if (success) {
      setState((s) => ({ ...s, status: "unsubscribed", error: null }));
    } else {
      setState((s) => ({
        ...s,
        error: "Failed to disable push notifications. Please try again.",
      }));
    }
  }, [state.platform]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    status: state.status,
    platform: state.platform,
    subscribing: state.subscribing,
    error: state.error,
    subscribe,
    unsubscribe,
    clearError,
  };
}
