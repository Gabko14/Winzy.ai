import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, bootstrapSession, tokenStore } from "../api";
import type { AuthResponse, UserProfile } from "../api";

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: UserProfile };

type AuthContextValue = AuthState & {
  login: (emailOrUsername: string, password: string) => Promise<AuthResponse>;
  register: (email: string, username: string, password: string, displayName?: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
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
    if (data.refreshToken) {
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
      if (data.refreshToken) {
        await tokenStore.setRefreshToken(data.refreshToken);
      }
      setState({ status: "authenticated", user: data.user });
      return data;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", undefined);
    } catch {
      // Best-effort: even if the server call fails, clear local state
    }
    await tokenStore.clear();
    setState({ status: "unauthenticated" });
  }, []);

  const value = useMemo(
    () => ({ ...state, login, register, logout }),
    [state, login, register, logout],
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
