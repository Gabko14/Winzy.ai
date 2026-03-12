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
          setState({ status: "unsupported", platform, subscribing: false });
        }
        return;
      }

      if (platform === "web_push") {
        const permission = getPushPermissionStatus();
        if (permission === "denied") {
          if (mountedRef.current) {
            setState({ status: "denied", platform, subscribing: false });
          }
          return;
        }

        const hasSubscription = await hasActiveWebPushSubscription();
        if (mountedRef.current) {
          setState({
            status: hasSubscription ? "subscribed" : "unsubscribed",
            platform,
            subscribing: false,
          });
        }
        return;
      }

      // expo_push: not yet implemented
      if (mountedRef.current) {
        setState({ status: "unsupported", platform, subscribing: false });
      }
    }

    checkStatus();
  }, []);

  const subscribe = useCallback(async () => {
    if (state.platform !== "web_push" || state.subscribing) return;

    setState((s) => ({ ...s, subscribing: true }));

    const deviceId = await subscribeToWebPush(() => {
      // Permission denied callback
      if (mountedRef.current) {
        setState((s) => ({ ...s, status: "denied", subscribing: false }));
      }
    });

    if (!mountedRef.current) return;

    setState((s) => ({
      ...s,
      status: deviceId ? "subscribed" : s.status === "denied" ? "denied" : "unsubscribed",
      subscribing: false,
    }));
  }, [state.platform, state.subscribing]);

  const unsubscribe = useCallback(async () => {
    if (state.platform !== "web_push") return;

    const success = await unsubscribeFromWebPush();
    if (!mountedRef.current) return;

    if (success) {
      setState((s) => ({ ...s, status: "unsubscribed" }));
    }
  }, [state.platform]);

  return {
    status: state.status,
    platform: state.platform,
    subscribing: state.subscribing,
    subscribe,
    unsubscribe,
  };
}
