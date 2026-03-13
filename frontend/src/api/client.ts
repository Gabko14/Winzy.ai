import { Platform } from "react-native";
import { tokenStore } from "./token";
import type { ApiError, AuthResponse } from "./types";

// Gateway is exposed on port 5050 in dev (macOS AirPlay conflict on 5000).
// Web production: same-origin (served behind gateway). Web dev: explicit gateway URL.
// Native: always explicit gateway URL.
const DEFAULT_BASE_URL =
  Platform.OS === "web"
    ? (process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://localhost:5050" : ""))
    : (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:5050");

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let baseUrl = DEFAULT_BASE_URL;

export function setBaseUrl(url: string) {
  baseUrl = url;
}

// --- Refresh lock: queue requests while a token refresh is in flight ---

let refreshPromise: Promise<boolean> | null = null;

type QueueEntry = {
  resolve: (success: boolean) => void;
};

const refreshQueue: QueueEntry[] = [];

function enqueueRefreshWait(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    refreshQueue.push({ resolve });
  });
}

function drainRefreshQueue(success: boolean) {
  const entries = refreshQueue.splice(0);
  for (const entry of entries) {
    entry.resolve(success);
  }
}

async function refreshTokens(): Promise<boolean> {
  // If a refresh is already in flight, wait for it
  if (refreshPromise) {
    return enqueueRefreshWait();
  }

  refreshPromise = doRefresh();
  try {
    const result = await refreshPromise;
    drainRefreshQueue(result);
    return result;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Shared refresh-and-store logic. Calls /auth/refresh, stores the new tokens,
 * and returns the AuthResponse on success or null on failure.
 * Used by both the 401-refresh path and session bootstrap.
 */
async function fetchRefreshAndStore(): Promise<AuthResponse | null> {
  // On web, refresh token lives in an httpOnly cookie — don't read from localStorage.
  // On native, read from local storage (will be SecureStore later).
  const refreshToken = Platform.OS === "web" ? null : await tokenStore.getRefreshToken();
  try {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      credentials: "include", // send httpOnly cookie on web
    });

    if (!res.ok) {
      // Only clear tokens on confirmed auth rejection (401/403).
      // Preserve tokens on transient server errors so offline/restart recovery works.
      if (res.status === 401 || res.status === 403) {
        await tokenStore.clear();
      }
      return null;
    }

    const data: AuthResponse = await res.json();
    await tokenStore.setAccessToken(data.accessToken);
    // On web, rely on httpOnly cookie for refresh — don't store in localStorage (XSS risk).
    // On native, persist refresh token for secure storage.
    if (data.refreshToken && Platform.OS !== "web") {
      await tokenStore.setRefreshToken(data.refreshToken);
    }
    return data;
  } catch {
    // Network error / offline — do NOT clear tokens. Preserve for retry.
    return null;
  }
}

async function doRefresh(): Promise<boolean> {
  return (await fetchRefreshAndStore()) !== null;
}

// --- Structured error mapping ---

function mapHttpError(status: number, body: unknown): ApiError {
  const base = { status };

  if (status === 401) {
    return { ...base, code: "unauthorized", message: "Session expired. Please sign in again." };
  }
  if (status === 403) {
    return { ...base, code: "forbidden", message: "You don't have permission for this action." };
  }
  if (status === 404) {
    return { ...base, code: "not_found", message: "The requested resource was not found." };
  }
  if (status === 409) {
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: string }).error)
        : "A conflict occurred.";
    return { ...base, code: "conflict", message: msg };
  }
  if (status === 422 || (typeof body === "object" && body !== null && "errors" in body)) {
    const problem = body as { errors?: Record<string, string[]> };
    return {
      ...base,
      code: "validation",
      message: "Please check your input.",
      validationErrors: problem.errors,
    };
  }
  if (status >= 500) {
    return { ...base, code: "server_error", message: "Something went wrong on our end. Please try again." };
  }
  return { ...base, code: "unknown", message: "An unexpected error occurred." };
}

function networkError(message: string): ApiError {
  return { status: 0, code: "network", message };
}

function timeoutError(): ApiError {
  return { status: 0, code: "timeout", message: "The request timed out. Please check your connection." };
}

// --- Core request function ---

export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip auth token injection (for login/register) */
  noAuth?: boolean;
  /** Skip automatic retry on transient failures */
  noRetry?: boolean;
  /** Custom timeout in ms */
  timeout?: number;
};

/**
 * Central API client.
 *
 * - Injects Authorization header from stored access token
 * - On 401: attempts a single token refresh then retries the original request
 * - Queues concurrent requests during token refresh (no thundering herd)
 * - Retries transient server errors (502/503/504) up to MAX_RETRIES
 * - Returns typed ApiError on failure
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, noAuth = false, noRetry = false, timeout = REQUEST_TIMEOUT_MS } = options;

  const url = `${baseUrl}${path}`;
  const reqHeaders: Record<string, string> = { ...headers };

  if (body !== undefined && !reqHeaders["Content-Type"]) {
    reqHeaders["Content-Type"] = "application/json";
  }

  if (!noAuth) {
    const token = await tokenStore.getAccessToken();
    if (token) {
      reqHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const fetchOptions: RequestInit = {
    method,
    headers: reqHeaders,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const attempt = async (retriesLeft: number, isRetryAfterRefresh: boolean): Promise<T> => {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, fetchOptions, timeout);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw timeoutError();
      }
      throw networkError("Unable to reach the server. Please check your connection.");
    }

    // 401 — try refresh once, then retry
    if (res.status === 401 && !noAuth && !isRetryAfterRefresh) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        // Update the auth header with new token
        const newToken = await tokenStore.getAccessToken();
        if (newToken) {
          reqHeaders["Authorization"] = `Bearer ${newToken}`;
          fetchOptions.headers = reqHeaders;
        }
        return attempt(retriesLeft, true);
      }
      // Refresh failed — surface as unauthorized
      throw mapHttpError(401, null);
    }

    // Retryable server errors (safe/idempotent methods only — replaying mutations is dangerous)
    if (RETRYABLE_STATUSES.has(res.status) && retriesLeft > 0 && !noRetry && SAFE_METHODS.has(method)) {
      await delay(300 * (MAX_RETRIES - retriesLeft + 1));
      return attempt(retriesLeft - 1, isRetryAfterRefresh);
    }

    if (!res.ok) {
      let responseBody: unknown = null;
      try {
        responseBody = await res.json();
      } catch {
        // body not JSON — that's fine
      }
      throw mapHttpError(res.status, responseBody);
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  };

  return attempt(MAX_RETRIES, false);
}

// --- Convenience methods ---

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "GET" }),

  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),

  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "PUT", body }),

  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
};

// --- Helpers ---

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Session bootstrap ---

/**
 * Attempt to restore a session on app load by refreshing the access token.
 * Returns the new AuthResponse on success, null on failure.
 */
export async function bootstrapSession(): Promise<AuthResponse | null> {
  // Clear any legacy refresh tokens left in localStorage from pre-httpOnly code.
  // Safe to call every bootstrap — it's a no-op if nothing is stored.
  await tokenStore.clearLegacyWebRefreshToken();

  // On web, hasToken will be false after legacy cleanup above — that's expected.
  // The httpOnly cookie path on line 296 handles session restoration.
  const refreshToken = await tokenStore.getRefreshToken();
  const hasToken = !!refreshToken;

  // On web, the httpOnly cookie may carry the refresh token even if
  // localStorage doesn't have one. Always attempt refresh on web.
  if (!hasToken && Platform.OS !== "web") {
    return null;
  }

  return fetchRefreshAndStore();
}
