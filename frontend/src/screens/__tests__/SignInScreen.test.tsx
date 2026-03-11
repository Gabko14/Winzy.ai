import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { SignInScreen } from "../SignInScreen";
import { AuthProvider } from "../../hooks/useAuth";

jest.mock("../../api", () => {
  const mockBootstrap = jest.fn().mockResolvedValue(null);
  const mockApi = {
    post: jest.fn(),
  };
  const mockTokenStore = {
    setAccessToken: jest.fn().mockResolvedValue(undefined),
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue(null),
    getRefreshToken: jest.fn().mockResolvedValue(null),
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

const navigateToSignUp = jest.fn();

function renderSignIn() {
  return render(
    <AuthProvider>
      <SignInScreen onNavigateToSignUp={navigateToSignUp} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SignInScreen", () => {
  it("renders the sign in form", () => {
    renderSignIn();
    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByText("Sign in to keep your flame alive")).toBeTruthy();
    expect(screen.getByLabelText("Email or username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("navigates to sign up when link is pressed", () => {
    renderSignIn();
    fireEvent.press(screen.getByText("Sign up"));
    expect(navigateToSignUp).toHaveBeenCalledTimes(1);
  });

  // --- Validation ---

  it("shows validation errors for empty fields on submit", async () => {
    renderSignIn();
    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });
    expect(screen.getByText("Email or username is required.")).toBeTruthy();
    expect(screen.getByText("Password is required.")).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows password validation error for short password", async () => {
    renderSignIn();
    fireEvent.changeText(screen.getByTestId("identifier-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "short");
    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });
    expect(screen.getByText("Password must be at least 8 characters.")).toBeTruthy();
  });

  it("clears field error when user types", async () => {
    renderSignIn();
    // Trigger validation errors
    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });
    expect(screen.getByText("Email or username is required.")).toBeTruthy();

    // Type in the field
    fireEvent.changeText(screen.getByTestId("identifier-input"), "a");
    expect(screen.queryByText("Email or username is required.")).toBeNull();
  });

  // --- API integration ---

  it("calls login on valid submit", async () => {
    api.post.mockResolvedValue({
      accessToken: "tok",
      refreshToken: "ref",
      user: { id: "1", email: "user@test.com", username: "user" },
    });

    renderSignIn();
    fireEvent.changeText(screen.getByTestId("identifier-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });

    expect(api.post).toHaveBeenCalledWith(
      "/auth/login",
      { emailOrUsername: "user@test.com", password: "password123" },
      { noAuth: true },
    );
  });

  it("shows server error for invalid credentials (401)", async () => {
    api.post.mockRejectedValue({
      status: 401,
      code: "unauthorized",
      message: "Session expired. Please sign in again.",
    });

    renderSignIn();
    fireEvent.changeText(screen.getByTestId("identifier-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "wrongpassword");

    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("server-error")).toBeTruthy();
      expect(
        screen.getByText("Invalid email/username or password. Please try again."),
      ).toBeTruthy();
    });
  });

  it("shows network error", async () => {
    api.post.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Unable to reach the server.",
    });

    renderSignIn();
    fireEvent.changeText(screen.getByTestId("identifier-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });

    await waitFor(() => {
      expect(
        screen.getByText("Unable to reach the server. Please check your connection."),
      ).toBeTruthy();
    });
  });

  it("shows server validation errors inline", async () => {
    api.post.mockRejectedValue({
      status: 422,
      code: "validation",
      message: "Please check your input.",
      validationErrors: {
        emailOrUsername: ["This field is required."],
      },
    });

    renderSignIn();
    fireEvent.changeText(screen.getByTestId("identifier-input"), "x");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });

    await waitFor(() => {
      expect(screen.getByText("This field is required.")).toBeTruthy();
    });
  });

  it("clears server error when user types", async () => {
    api.post.mockRejectedValue({
      status: 401,
      code: "unauthorized",
      message: "Session expired.",
    });

    renderSignIn();
    fireEvent.changeText(screen.getByTestId("identifier-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "wrongpassword");

    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("server-error")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("identifier-input"), "user@test.com2");
    expect(screen.queryByTestId("server-error")).toBeNull();
  });

  it("handles generic error gracefully", async () => {
    api.post.mockRejectedValue(new Error("unexpected"));

    renderSignIn();
    fireEvent.changeText(screen.getByTestId("identifier-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Sign in"));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy();
    });
  });
});
