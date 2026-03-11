import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { ProfileScreen } from "../ProfileScreen";
import { AuthProvider } from "../../hooks/useAuth";

jest.mock("../../api", () => {
  const mockBootstrap = jest.fn().mockResolvedValue({
    accessToken: "tok",
    refreshToken: "ref",
    user: {
      id: "1",
      email: "alice@test.com",
      username: "alice",
      displayName: "Alice Smith",
      avatarUrl: null,
      createdAt: "2026-01-01",
    },
  });
  const mockApi = {
    post: jest.fn(),
    put: jest.fn(),
  };
  const mockTokenStore = {
    setAccessToken: jest.fn().mockResolvedValue(undefined),
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue("tok"),
    getRefreshToken: jest.fn().mockResolvedValue("ref"),
    clear: jest.fn().mockResolvedValue(undefined),
  };

  return {
    bootstrapSession: mockBootstrap,
    api: mockApi,
    tokenStore: mockTokenStore,
    isApiError: jest.requireActual("../../api/types").isApiError,
  };
});

const { api } = jest.requireMock("../../api");

const onEditProfile = jest.fn();
const onSettings = jest.fn();

function renderProfile() {
  return render(
    <AuthProvider>
      <ProfileScreen onEditProfile={onEditProfile} onSettings={onSettings} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ProfileScreen", () => {
  it("renders profile with display name, username, and email", async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByTestId("profile-screen")).toBeTruthy();
    });

    expect(screen.getByTestId("profile-display-name").props.children).toBe("Alice Smith");
    expect(screen.getByTestId("profile-username").props.children).toEqual(["@", "alice"]);
    expect(screen.getByTestId("profile-email").props.children).toBe("alice@test.com");
  });

  it("shows initials from display name", async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByTestId("profile-avatar")).toBeTruthy();
    });

    // "Alice Smith" → "AS"
    const avatarText = screen.getByTestId("profile-avatar");
    expect(avatarText).toBeTruthy();
  });

  it("navigates to edit profile when edit button is pressed", async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByText("Edit profile")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Edit profile"));
    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it("navigates to settings when settings link is pressed", async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByTestId("settings-link")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-link"));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("signs out when sign out is pressed", async () => {
    api.post.mockResolvedValue(undefined);

    renderProfile();
    await waitFor(() => {
      expect(screen.getByText("Sign out")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Sign out"));
    // logout calls api.post("/auth/logout")
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/auth/logout", undefined);
    });
  });
});

describe("ProfileScreen — fallback display", () => {
  beforeEach(() => {
    const { bootstrapSession } = jest.requireMock("../../api");
    bootstrapSession.mockResolvedValue({
      accessToken: "tok",
      refreshToken: "ref",
      user: {
        id: "2",
        email: "bob@test.com",
        username: "bobthebuilder",
        displayName: null,
        avatarUrl: null,
        createdAt: "2026-01-01",
      },
    });
  });

  it("falls back to username when displayName is null", async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByTestId("profile-display-name")).toBeTruthy();
    });

    expect(screen.getByTestId("profile-display-name").props.children).toBe("bobthebuilder");
  });
});
