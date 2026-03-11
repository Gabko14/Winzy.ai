import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { EditProfileScreen } from "../EditProfileScreen";
import { AuthProvider } from "../../hooks/useAuth";

jest.mock("../../api", () => {
  const mockBootstrap = jest.fn().mockResolvedValue({
    accessToken: "tok",
    refreshToken: "ref",
    user: {
      id: "1",
      email: "alice@test.com",
      username: "alice",
      displayName: "Alice",
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

const onBack = jest.fn();

async function renderEditProfile() {
  const result = render(
    <AuthProvider>
      <EditProfileScreen onBack={onBack} />
    </AuthProvider>,
  );
  // Wait for auth bootstrap + display name seeding
  await waitFor(() => {
    expect(screen.getByTestId("edit-display-name-input").props.value).toBe("Alice");
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("EditProfileScreen", () => {
  it("renders with current display name pre-filled", async () => {
    await renderEditProfile();

    expect(screen.getByText("Edit profile")).toBeTruthy();
    expect(screen.getByTestId("edit-display-name-input").props.value).toBe("Alice");
    expect(screen.getByText("Save changes")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("shows error for empty display name", async () => {
    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    expect(screen.getByText("Display name cannot be empty.")).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("shows error for overly long display name", async () => {
    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "B".repeat(129));

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    expect(screen.getByText("Display name must not exceed 128 characters.")).toBeTruthy();
  });

  it("skips API call and navigates back when name is unchanged", async () => {
    await renderEditProfile();

    // Name is already "Alice", pressing Save should call onBack without API call
    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    expect(api.put).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("saves profile and shows success message", async () => {
    api.put.mockResolvedValue({
      id: "1",
      email: "alice@test.com",
      username: "alice",
      displayName: "Alice Updated",
      avatarUrl: null,
      createdAt: "2026-01-01",
    });

    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "Alice Updated");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    expect(api.put).toHaveBeenCalledWith("/auth/profile", { displayName: "Alice Updated" });
    await waitFor(() => {
      expect(screen.getByTestId("edit-success")).toBeTruthy();
      expect(screen.getByText("Profile updated!")).toBeTruthy();
    });
  });

  it("navigates back when cancel is pressed", async () => {
    await renderEditProfile();

    fireEvent.press(screen.getByText("Cancel"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows network error on API failure", async () => {
    api.put.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Unable to reach the server.",
    });

    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "New Name");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Unable to reach the server. Please check your connection.")).toBeTruthy();
    });
  });

  it("shows server validation error", async () => {
    api.put.mockRejectedValue({
      status: 422,
      code: "validation",
      message: "Please check your input.",
      validationErrors: {
        displayName: ["Display name contains invalid characters."],
      },
    });

    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "Bad<>Name");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Display name contains invalid characters.")).toBeTruthy();
    });
  });

  it("shows generic error for unexpected failures", async () => {
    api.put.mockRejectedValue(new Error("unexpected"));

    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "New Name");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy();
    });
  });

  it("clears error when user types", async () => {
    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    expect(screen.getByText("Display name cannot be empty.")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "A");
    expect(screen.queryByText("Display name cannot be empty.")).toBeNull();
  });

  it("clears success message when user types", async () => {
    api.put.mockResolvedValue({
      id: "1",
      email: "alice@test.com",
      username: "alice",
      displayName: "New Name",
      avatarUrl: null,
      createdAt: "2026-01-01",
    });

    await renderEditProfile();

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "New Name");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("edit-success")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("edit-display-name-input"), "Another Name");
    expect(screen.queryByTestId("edit-success")).toBeNull();
  });
});
