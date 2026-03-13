import { Platform } from "react-native";

const ACCESS_KEY = "winzy_access_token";
const REFRESH_KEY = "winzy_refresh_token";

/**
 * Token storage abstraction.
 *
 * Web: uses localStorage (httpOnly refresh cookie is the real security layer).
 * Native: will use SecureStore when native builds ship — for now localStorage
 * is fine because native isn't exposed yet.
 */

function getStorage() {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    return {
      getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key: string, value: string) => {
        localStorage.setItem(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        localStorage.removeItem(key);
        return Promise.resolve();
      },
    };
  }
  // Fallback: in-memory (tests, SSR)
  const mem = new Map<string, string>();
  return {
    getItem: (key: string) => Promise.resolve(mem.get(key) ?? null),
    setItem: (key: string, value: string) => {
      mem.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      mem.delete(key);
      return Promise.resolve();
    },
  };
}

const storage = getStorage();

export const tokenStore = {
  getAccessToken: () => storage.getItem(ACCESS_KEY),
  setAccessToken: (token: string) => storage.setItem(ACCESS_KEY, token),

  getRefreshToken: () => storage.getItem(REFRESH_KEY),
  setRefreshToken: (token: string) => storage.setItem(REFRESH_KEY, token),

  clear: async () => {
    await storage.removeItem(ACCESS_KEY);
    await storage.removeItem(REFRESH_KEY);
  },

  /**
   * Remove legacy refresh tokens from localStorage on web.
   * Previous code stored refresh tokens in localStorage; now web uses httpOnly cookies.
   * Call during session bootstrap to clean up upgraded users.
   */
  clearLegacyWebRefreshToken: async () => {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      localStorage.removeItem(REFRESH_KEY);
    }
  },
};
