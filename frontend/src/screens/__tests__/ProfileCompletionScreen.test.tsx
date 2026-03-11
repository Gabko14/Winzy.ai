import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { ProfileCompletionScreen } from "../ProfileCompletionScreen";
import { AuthProvider } from "../../hooks/useAuth";

jest.mock("../../api", () => {
  const mockBootstrap = jest.fn().mockResolvedValue({
    accessToken: "tok",
    refreshToken: "ref",
    user: { id: "1", email: "user@test.com", username: "alice", displayName: null, avatarUrl: null, createdAt: "2026-01-01" },
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

const onComplete = jest.fn();

function renderCompletion() {
  return render(
    <AuthProvider>
      <ProfileCompletionScreen onComplete={onComplete} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ProfileCompletionScreen", () => {
  it("renders the completion form", async () => {
    renderCompletion();
    await waitFor(() => {
      expect(screen.getByText("What should we call you?")).toBeTruthy();
    });
    expect(screen.getByText("Pick a display name. You can change it later.")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByText("Continue")).toBeTruthy();
    expect(screen.getByText("Skip for now")).toBeTruthy();
  });

  it("shows error for empty display name on submit", async () => {
    renderCompletion();
    await waitFor(() => {
      expect(screen.getByText("Continue")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Continue"));
    });

    expect(screen.getByText("Please enter a display name.")).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("shows error for overly long display name", async () => {
    renderCompletion();
    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("display-name-input"), "A".repeat(129));

    await act(async () => {
      fireEvent.press(screen.getByText("Continue"));
    });

    expect(screen.getByText("Display name must not exceed 128 characters.")).toBeTruthy();
  });

  it("calls updateProfile and onComplete on successful save", async () => {
    api.put.mockResolvedValue({
      id: "1",
      email: "user@test.com",
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
      createdAt: "2026-01-01",
    });

    renderCompletion();
    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("display-name-input"), "Alice");

    await act(async () => {
      fireEvent.press(screen.getByText("Continue"));
    });

    expect(api.put).toHaveBeenCalledWith("/auth/profile", { displayName: "Alice" });
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it("calls onComplete when skip is pressed", async () => {
    renderCompletion();
    await waitFor(() => {
      expect(screen.getByText("Skip for now")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Skip for now"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("shows network error on API failure", async () => {
    api.put.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Unable to reach the server.",
    });

    renderCompletion();
    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("display-name-input"), "Alice");

    await act(async () => {
      fireEvent.press(screen.getByText("Continue"));
    });

    await waitFor(() => {
      expect(screen.getByText("Unable to reach the server. Please check your connection.")).toBeTruthy();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows validation error from server", async () => {
    api.put.mockRejectedValue({
      status: 422,
      code: "validation",
      message: "Please check your input.",
      validationErrors: {
        displayName: ["Display name is too long."],
      },
    });

    renderCompletion();
    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("display-name-input"), "Alice");

    await act(async () => {
      fireEvent.press(screen.getByText("Continue"));
    });

    await waitFor(() => {
      expect(screen.getByText("Display name is too long.")).toBeTruthy();
    });
  });

  it("shows generic error for unexpected failures", async () => {
    api.put.mockRejectedValue(new Error("unexpected"));

    renderCompletion();
    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("display-name-input"), "Alice");

    await act(async () => {
      fireEvent.press(screen.getByText("Continue"));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy();
    });
  });

  it("clears error when user types", async () => {
    renderCompletion();
    await waitFor(() => {
      expect(screen.getByText("Continue")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Continue"));
    });

    expect(screen.getByText("Please enter a display name.")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("display-name-input"), "A");
    expect(screen.queryByText("Please enter a display name.")).toBeNull();
  });
});
