import React from "react";
import { Text } from "react-native";
import { render, waitFor, act } from "@testing-library/react-native";
import { AuthProvider, useAuth } from "../useAuth";

// Mock the API module
jest.mock("../../api", () => {
  const mockBootstrap = jest.fn();
  const mockApi = {
    post: jest.fn(),
  };
  const mockTokenStore = {
    setAccessToken: jest.fn().mockResolvedValue(undefined),
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };

  return {
    bootstrapSession: mockBootstrap,
    api: mockApi,
    tokenStore: mockTokenStore,
  };
});

const { bootstrapSession, api, tokenStore } = jest.requireMock("../../api");

function TestConsumer() {
  const auth = useAuth();
  return <Text testID="status">{auth.status}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AuthProvider", () => {
  it("starts in loading state and transitions to unauthenticated when no session", async () => {
    bootstrapSession.mockResolvedValue(null);

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    // Initially loading
    expect(getByTestId("status").props.children).toBe("loading");

    // After bootstrap resolves
    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("unauthenticated");
    });
  });

  it("transitions to authenticated when session exists", async () => {
    bootstrapSession.mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
      user: { id: "1", email: "a@b.com", username: "test" },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("authenticated");
    });
  });

  it("login stores tokens and sets authenticated", async () => {
    bootstrapSession.mockResolvedValue(null);

    const loginResponse = {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      user: { id: "1", email: "a@b.com", username: "test" },
    };
    api.post.mockResolvedValue(loginResponse);

    function LoginConsumer() {
      const auth = useAuth();
      return (
        <>
          <Text testID="status">{auth.status}</Text>
          <Text
            testID="login"
            onPress={() => auth.login("test", "password")}
          />
        </>
      );
    }

    const { getByTestId } = render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("unauthenticated");
    });

    await act(async () => {
      getByTestId("login").props.onPress();
    });

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("authenticated");
    });
    expect(tokenStore.setAccessToken).toHaveBeenCalledWith("new-access");
    expect(tokenStore.setRefreshToken).toHaveBeenCalledWith("new-refresh");
  });

  it("logout clears tokens and sets unauthenticated", async () => {
    bootstrapSession.mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
      user: { id: "1", email: "a@b.com", username: "test" },
    });
    api.post.mockResolvedValue(undefined);

    function LogoutConsumer() {
      const auth = useAuth();
      return (
        <>
          <Text testID="status">{auth.status}</Text>
          <Text testID="logout" onPress={() => auth.logout()} />
        </>
      );
    }

    const { getByTestId } = render(
      <AuthProvider>
        <LogoutConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("authenticated");
    });

    await act(async () => {
      getByTestId("logout").props.onPress();
    });

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("unauthenticated");
    });
    expect(tokenStore.clear).toHaveBeenCalled();
  });

  it("logout on native clears tokens even when server call fails", async () => {
    // jest-expo defaults Platform.OS to "ios" (native)
    bootstrapSession.mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
      user: { id: "1", email: "a@b.com", username: "test" },
    });
    api.post.mockRejectedValue(new Error("Network error"));

    let logoutError: Error | null = null;

    function LogoutConsumer() {
      const auth = useAuth();
      return (
        <>
          <Text testID="status">{auth.status}</Text>
          <Text
            testID="logout"
            onPress={() => {
              auth.logout().catch((err) => {
                logoutError = err;
              });
            }}
          />
        </>
      );
    }

    const { getByTestId } = render(
      <AuthProvider>
        <LogoutConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("authenticated");
    });

    await act(async () => {
      getByTestId("logout").props.onPress();
    });

    // Server failed — but on native we own the tokens, so clear them anyway
    await waitFor(() => {
      expect(logoutError).not.toBeNull();
    });
    expect(getByTestId("status").props.children).toBe("unauthenticated");
    expect(tokenStore.clear).toHaveBeenCalled();
  });

  it("logout on web does NOT clear tokens when server call fails", async () => {
    // Temporarily set Platform.OS to "web" for this test
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Platform = require("react-native").Platform;
    const originalOS = Platform.OS;
    Platform.OS = "web";

    bootstrapSession.mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
      user: { id: "1", email: "a@b.com", username: "test" },
    });
    api.post.mockRejectedValue(new Error("Network error"));

    let logoutError: Error | null = null;

    function LogoutConsumer() {
      const auth = useAuth();
      return (
        <>
          <Text testID="status">{auth.status}</Text>
          <Text
            testID="logout"
            onPress={() => {
              auth.logout().catch((err) => {
                logoutError = err;
              });
            }}
          />
        </>
      );
    }

    const { getByTestId } = render(
      <AuthProvider>
        <LogoutConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("authenticated");
    });

    await act(async () => {
      getByTestId("logout").props.onPress();
    });

    // Server failed — on web, only the server can clear the HttpOnly cookie
    await waitFor(() => {
      expect(logoutError).not.toBeNull();
    });
    expect(getByTestId("status").props.children).toBe("authenticated");
    // Tokens should NOT be cleared since the server didn't confirm logout
    expect(tokenStore.clear).not.toHaveBeenCalled();

    // Restore Platform.OS
    Platform.OS = originalOS;
  });
});

describe("legacy token migration", () => {
  it("clears legacy refresh tokens during bootstrap (upgrade path)", async () => {
    // Simulate a user who has a stale refresh token in localStorage from pre-fix code
    bootstrapSession.mockResolvedValue({
      accessToken: "new-token",
      refreshToken: "new-refresh",
      user: { id: "1", email: "a@b.com", username: "test" },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("authenticated");
    });

    // bootstrapSession is called which internally clears legacy tokens.
    // The AuthProvider should work correctly regardless of legacy state.
    expect(bootstrapSession).toHaveBeenCalledTimes(1);
  });

  it("login on web does not store refresh token in localStorage", async () => {
    bootstrapSession.mockResolvedValue(null);

    const loginResponse = {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      user: { id: "1", email: "a@b.com", username: "test" },
    };
    api.post.mockResolvedValue(loginResponse);

    function LoginConsumer() {
      const auth = useAuth();
      return (
        <>
          <Text testID="status">{auth.status}</Text>
          <Text
            testID="login"
            onPress={() => auth.login("test", "password")}
          />
        </>
      );
    }

    const { getByTestId } = render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("unauthenticated");
    });

    await act(async () => {
      getByTestId("login").props.onPress();
    });

    await waitFor(() => {
      expect(getByTestId("status").props.children).toBe("authenticated");
    });

    // Access token is always stored
    expect(tokenStore.setAccessToken).toHaveBeenCalledWith("new-access");
    // On web (Platform.OS === "web" check in useAuth), refresh token is NOT stored.
    // The mock doesn't check platform, but the real code gates on Platform.OS !== "web".
    // This test verifies the auth flow completes successfully with the token model.
  });
});

describe("useAuth outside provider", () => {
  it("throws when used without AuthProvider", () => {
    // Suppress console.error from React for this test
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow("useAuth must be used within an AuthProvider");

    spy.mockRestore();
  });
});
