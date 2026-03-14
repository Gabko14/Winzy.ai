import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

const WELCOME_SEEN_KEY = "winzy_onboarding_welcome_seen";
const FLAME_INTRO_SEEN_KEY = "winzy_onboarding_flame_intro_seen";

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

export function useOnboarding(): OnboardingState {
  const [loading, setLoading] = useState(true);
  const [hasSeenWelcome, setHasSeenWelcome] = useState(false);
  const [hasSeenFlameIntro, setHasSeenFlameIntro] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const s = getStorage();
    Promise.all([
      s.getItem(WELCOME_SEEN_KEY),
      s.getItem(FLAME_INTRO_SEEN_KEY),
    ]).then(([welcome, flame]) => {
      if (cancelled) return;
      setHasSeenWelcome(welcome === "true");
      setHasSeenFlameIntro(flame === "true");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markWelcomeSeen = useCallback(() => {
    setHasSeenWelcome(true);
    getStorage().setItem(WELCOME_SEEN_KEY, "true").catch(() => {});
  }, []);

  const markFlameIntroSeen = useCallback(() => {
    setHasSeenFlameIntro(true);
    getStorage().setItem(FLAME_INTRO_SEEN_KEY, "true").catch(() => {});
  }, []);

  return { loading, hasSeenWelcome, hasSeenFlameIntro, markWelcomeSeen, markFlameIntroSeen };
}

/** @internal Test-only: clear in-memory storage between tests. */
export function _resetOnboardingStorage(): void {
  mem.clear();
}
