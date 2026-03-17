import { Platform } from "react-native";

const ACCESS_KEY = "winzy_access_token";
const REFRESH_KEY = "winzy_refresh_token";

type SimpleStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function createMemoryStorage(): SimpleStorage {
  const mem = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(mem.get(key) ?? null),
    setItem: (key, value) => {
      mem.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      mem.delete(key);
      return Promise.resolve();
    },
  };
}

function createLocalStorage(): SimpleStorage {
  return {
    getItem: (key) => Promise.resolve(localStorage.getItem(key)),
    setItem: (key, value) => {
      localStorage.setItem(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      localStorage.removeItem(key);
      return Promise.resolve();
    },
  };
}

/**
 * Token storage abstraction.
 *
 * Web:    access token is memory-only (never touches localStorage — XSS-safe).
 *         Refresh token lives exclusively in the HttpOnly cookie; tokenStore
 *         never reads or writes it on web.
 * Native: localStorage for now (will be SecureStore when native builds ship).
 *         Refresh token is stored here because native has no cookie jar.
 */
const isWeb = Platform.OS === "web";
const hasLocalStorage = typeof localStorage !== "undefined";

// Web access tokens: always in-memory (survives only for the tab lifetime).
// Native tokens: localStorage (persists across restarts).
const accessStorage = isWeb ? createMemoryStorage() : (hasLocalStorage ? createLocalStorage() : createMemoryStorage());
const refreshStorage = isWeb ? createMemoryStorage() : (hasLocalStorage ? createLocalStorage() : createMemoryStorage());

export const tokenStore = {
  getAccessToken: () => accessStorage.getItem(ACCESS_KEY),
  setAccessToken: (token: string) => accessStorage.setItem(ACCESS_KEY, token),

  // On web, refresh token is in the HttpOnly cookie — these are no-ops.
  // On native, refresh token is persisted in local/secure storage.
  getRefreshToken: () => refreshStorage.getItem(REFRESH_KEY),
  setRefreshToken: (token: string) => refreshStorage.setItem(REFRESH_KEY, token),

  clear: async () => {
    await accessStorage.removeItem(ACCESS_KEY);
    await refreshStorage.removeItem(REFRESH_KEY);
  },

  /**
   * Remove legacy refresh tokens from localStorage on web.
   * Previous code stored refresh tokens in localStorage; now web uses httpOnly cookies.
   * Call during session bootstrap to clean up upgraded users.
   */
  clearLegacyWebRefreshToken: async () => {
    if (isWeb && hasLocalStorage) {
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(ACCESS_KEY);
    }
  },
};
