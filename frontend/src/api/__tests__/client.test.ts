import { apiRequest, bootstrapSession, setBaseUrl } from "../client";
import { tokenStore } from "../token";
import type { ApiError } from "../types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
  setBaseUrl("http://test-api");
  tokenStore.clear();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone: () => jsonResponse(status, body),
    headers: new Headers(),
  } as unknown as Response;
}

describe("apiRequest", () => {
  // --- Happy path ---

  it("makes a GET request and returns JSON", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { id: "1", name: "test" }));

    const result = await apiRequest("/habits", { noAuth: true });

    expect(result).toEqual({ id: "1", name: "test" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-api/habits");
    expect(opts.method).toBe("GET");
  });

  it("sends POST with JSON body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, { id: "1" }));

    await apiRequest("/habits", {
      method: "POST",
      body: { name: "Exercise" },
      noAuth: true,
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe(JSON.stringify({ name: "Exercise" }));
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("handles 204 No Content", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(204, null));

    const result = await apiRequest("/auth/logout", { method: "POST", noAuth: true });
    expect(result).toBeUndefined();
  });

  it("injects Authorization header from stored token", async () => {
    await tokenStore.setAccessToken("test-token-123");
    mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));

    await apiRequest("/habits");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Authorization"]).toBe("Bearer test-token-123");
  });

  it("skips Authorization when noAuth is true", async () => {
    await tokenStore.setAccessToken("test-token-123");
    mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));

    await apiRequest("/auth/login", { noAuth: true });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Authorization"]).toBeUndefined();
  });

  // --- Error conditions ---

  it("maps 401 to unauthorized ApiError", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, null));

    try {
      await apiRequest("/profile", { noAuth: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("unauthorized");
      expect(error.status).toBe(401);
    }
  });

  it("maps 404 to not_found ApiError", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, null));

    try {
      await apiRequest("/habits/missing", { noAuth: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("not_found");
      expect(error.status).toBe(404);
    }
  });

  it("maps 409 with error body to conflict ApiError", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(409, { error: "Username already taken." }),
    );

    try {
      await apiRequest("/auth/register", { method: "POST", noAuth: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("conflict");
      expect(error.message).toBe("Username already taken.");
    }
  });

  it("maps validation errors with errors field", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(422, { errors: { email: ["Invalid email"] } }),
    );

    try {
      await apiRequest("/auth/register", { method: "POST", noAuth: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("validation");
      expect(error.validationErrors).toEqual({ email: ["Invalid email"] });
    }
  });

  it("maps 500 to server_error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, null));

    try {
      await apiRequest("/habits", { noAuth: true, noRetry: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("server_error");
    }
  });

  it("maps network failure to network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    try {
      await apiRequest("/habits", { noAuth: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("network");
      expect(error.status).toBe(0);
    }
  });

  it("maps AbortError to timeout", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    mockFetch.mockRejectedValueOnce(abortError);

    try {
      await apiRequest("/habits", { noAuth: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("timeout");
    }
  });

  // --- Token refresh on 401 ---

  it("refreshes token on 401 and retries the original request", async () => {
    await tokenStore.setAccessToken("old-token");
    await tokenStore.setRefreshToken("refresh-token");

    // First call: 401
    mockFetch.mockResolvedValueOnce(jsonResponse(401, null));
    // Refresh call: success
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: "new-token",
        refreshToken: "new-refresh",
        user: { id: "1", email: "test@test.com", username: "test" },
      }),
    );
    // Retry of original call: success
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { data: "success" }));

    const result = await apiRequest("/habits");

    expect(result).toEqual({ data: "success" });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify the retried request uses the new token
    const [, retryOpts] = mockFetch.mock.calls[2];
    expect(retryOpts.headers["Authorization"]).toBe("Bearer new-token");
  });

  it("surfaces 401 when refresh fails", async () => {
    await tokenStore.setAccessToken("old-token");
    await tokenStore.setRefreshToken("refresh-token");

    // First call: 401
    mockFetch.mockResolvedValueOnce(jsonResponse(401, null));
    // Refresh call: also 401
    mockFetch.mockResolvedValueOnce(jsonResponse(401, null));

    try {
      await apiRequest("/habits");
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("unauthorized");
    }

    // Tokens should be cleared
    expect(await tokenStore.getAccessToken()).toBeNull();
  });

  // --- Retry on transient errors ---

  it("retries on 503 and succeeds", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(503, null));
    mockFetch.mockResolvedValueOnce(jsonResponse(503, null));
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await apiRequest("/habits", { noAuth: true });
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries on 502", async () => {
    mockFetch.mockResolvedValue(jsonResponse(502, null));

    try {
      await apiRequest("/habits", { noAuth: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("server_error");
    }
    // Initial + 2 retries = 3
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry when noRetry is set", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(503, null));

    try {
      await apiRequest("/habits", { noAuth: true, noRetry: true });
      fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("server_error");
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // --- Legacy token cleanup ---

  it("bootstrapSession clears legacy web refresh tokens", async () => {
    const clearSpy = jest.spyOn(tokenStore, "clearLegacyWebRefreshToken");

    // No token stored + non-web platform → bootstrapSession returns null early
    // without calling fetch. Cleanup still runs.
    await bootstrapSession();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("bootstrapSession clears legacy token before attempting refresh", async () => {
    const callOrder: string[] = [];
    const clearSpy = jest.spyOn(tokenStore, "clearLegacyWebRefreshToken").mockImplementation(async () => {
      callOrder.push("clearLegacy");
    });
    const getRefreshSpy = jest.spyOn(tokenStore, "getRefreshToken").mockImplementation(async () => {
      callOrder.push("getRefresh");
      return "stale-token";
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        user: { id: "1", email: "a@b.com", username: "test" },
      }),
    );

    await bootstrapSession();

    // clearLegacy must happen before getRefresh
    expect(callOrder[0]).toBe("clearLegacy");
    expect(callOrder[1]).toBe("getRefresh");

    clearSpy.mockRestore();
    getRefreshSpy.mockRestore();
    mockFetch.mockReset();
  });

  // --- Concurrent refresh queue ---

  it("queues concurrent 401 requests behind a single refresh", async () => {
    await tokenStore.setAccessToken("old-token");
    await tokenStore.setRefreshToken("refresh-token");

    let refreshCallCount = 0;

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshCallCount++;
        return jsonResponse(200, {
          accessToken: "new-token",
          refreshToken: "new-refresh",
          user: { id: "1", email: "t@t.com", username: "t" },
        });
      }
      // First attempt: 401; retries succeed
      if (!url.includes("/auth/")) {
        const callsForUrl = mockFetch.mock.calls.filter(
          ([u]: [string]) => u === url,
        ).length;
        if (callsForUrl <= 1) return jsonResponse(401, null);
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, {});
    });

    const [r1, r2] = await Promise.all([
      apiRequest("/habits"),
      apiRequest("/profile"),
    ]);

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    // Only one refresh call despite two concurrent 401s
    expect(refreshCallCount).toBe(1);
  });
});
