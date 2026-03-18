import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

const WELCOME_SEEN_PREFIX = "winzy_onboarding_welcome_seen_";
const FLAME_INTRO_SEEN_PREFIX = "winzy_onboarding_flame_intro_seen_";
// Legacy keys (pre-Wave 8, not user-scoped) — used for migration
const LEGACY_WELCOME_KEY = "winzy_onboarding_welcome_seen";
const LEGACY_FLAME_KEY = "winzy_onboarding_flame_intro_seen";

type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

// In-memory fallback (native, SSR, tests)
const mem = new Map<string, string>();
const memStorage: Storage = {
  getItem: (key) => Promise.resolve(mem.get(key) ?? null),
  setItem: (key, value) => {
    mem.set(key, value);
    return Promise.resolve();
  },
};

function getStorage(): Storage {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    return {
      getItem: (key) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key, value) => {
        localStorage.setItem(key, value);
        return Promise.resolve();
      },
    };
  }
  return memStorage;
}

export type OnboardingState = {
  loading: boolean;
  hasSeenWelcome: boolean;
  hasSeenFlameIntro: boolean;
  markWelcomeSeen: () => void;
  markFlameIntroSeen: () => void;
};

export function useOnboarding(userId: string): OnboardingState {
  const welcomeKey = `${WELCOME_SEEN_PREFIX}${userId}`;
  const flameKey = `${FLAME_INTRO_SEEN_PREFIX}${userId}`;

  const [loading, setLoading] = useState(true);
  const [hasSeenWelcome, setHasSeenWelcome] = useState(false);
  const [hasSeenFlameIntro, setHasSeenFlameIntro] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHasSeenWelcome(false);
    setHasSeenFlameIntro(false);
    const s = getStorage();
    // Read user-scoped keys first, fall back to legacy (pre-Wave 8) keys for migration
    Promise.all([
      s.getItem(welcomeKey),
      s.getItem(flameKey),
      s.getItem(LEGACY_WELCOME_KEY),
      s.getItem(LEGACY_FLAME_KEY),
    ]).then(([welcome, flame, legacyWelcome, legacyFlame]) => {
      if (cancelled) return;
      const seenWelcome = welcome === "true" || legacyWelcome === "true";
      const seenFlame = flame === "true" || legacyFlame === "true";
      setHasSeenWelcome(seenWelcome);
      setHasSeenFlameIntro(seenFlame);
      // Migrate legacy keys to user-scoped keys
      if (userId && legacyWelcome === "true" && welcome !== "true") {
        s.setItem(welcomeKey, "true").catch(() => {});
      }
      if (userId && legacyFlame === "true" && flame !== "true") {
        s.setItem(flameKey, "true").catch(() => {});
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [welcomeKey, flameKey]);

  const markWelcomeSeen = useCallback(() => {
    setHasSeenWelcome(true);
    getStorage().setItem(welcomeKey, "true").catch(() => {});
  }, [welcomeKey]);

  const markFlameIntroSeen = useCallback(() => {
    setHasSeenFlameIntro(true);
    getStorage().setItem(flameKey, "true").catch(() => {});
  }, [flameKey]);

  return { loading, hasSeenWelcome, hasSeenFlameIntro, markWelcomeSeen, markFlameIntroSeen };
}

/** @internal Test-only: clear in-memory storage between tests. */
export function _resetOnboardingStorage(): void {
  mem.clear();
}
