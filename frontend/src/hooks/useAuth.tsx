import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { api, bootstrapSession, tokenStore } from "../api";
import type { AuthResponse, UpdateProfileRequest, UserProfile } from "../api";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: UserProfile };

type AuthContextValue = AuthState & {
  login: (emailOrUsername: string, password: string) => Promise<AuthResponse>;
  register: (email: string, username: string, password: string, displayName?: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  updateProfile: (request: UpdateProfileRequest) => Promise<UserProfile>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  // Bootstrap session on mount
  useEffect(() => {
    let cancelled = false;
    bootstrapSession().then((result) => {
      if (cancelled) return;
      if (result) {
        setState({ status: "authenticated", user: result.user });
      } else {
        setState({ status: "unauthenticated" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (emailOrUsername: string, password: string) => {
    const data = await api.post<AuthResponse>("/auth/login", { emailOrUsername, password }, { noAuth: true });
    await tokenStore.setAccessToken(data.accessToken);
    // On web, rely on httpOnly cookie for refresh — don't store in localStorage (XSS risk).
    if (data.refreshToken && Platform.OS !== "web") {
      await tokenStore.setRefreshToken(data.refreshToken);
    }
    setState({ status: "authenticated", user: data.user });
    return data;
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string, displayName?: string) => {
      const data = await api.post<AuthResponse>(
        "/auth/register",
        { email, username, password, displayName },
        { noAuth: true },
      );
      await tokenStore.setAccessToken(data.accessToken);
      // On web, rely on httpOnly cookie for refresh — don't store in localStorage (XSS risk).
      if (data.refreshToken && Platform.OS !== "web") {
        await tokenStore.setRefreshToken(data.refreshToken);
      }
      setState({ status: "authenticated", user: data.user });
      return data;
    },
    [],
  );

  const updateProfile = useCallback(async (request: UpdateProfileRequest) => {
    const profile = await api.put<UserProfile>("/auth/profile", request);
    setState((prev) => (prev.status === "authenticated" ? { status: "authenticated", user: profile } : prev));
    return profile;
  }, []);

  const logout = useCallback(async () => {
    // The server must revoke the refresh token and clear the HttpOnly cookie.
    // If that call fails, the cookie is still alive and the session persists.
    // On web, JS cannot clear HttpOnly cookies — only the server can.
    // Surface the error so the UI can inform the user truthfully.
    await api.post("/auth/logout", undefined);
    await tokenStore.clear();
    setState({ status: "unauthenticated" });
  }, []);

  const deleteAccount = useCallback(async () => {
    await api.delete("/auth/account");
    await tokenStore.clear();
    setState({ status: "unauthenticated" });
  }, []);

  const value = useMemo(
    () => ({ ...state, login, register, logout, updateProfile, deleteAccount }),
    [state, login, register, logout, updateProfile, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
