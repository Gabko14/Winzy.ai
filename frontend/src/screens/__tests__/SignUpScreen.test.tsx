import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { SignUpScreen } from "../SignUpScreen";
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

const navigateToSignIn = jest.fn();

function renderSignUp() {
  return render(
    <AuthProvider>
      <SignUpScreen onNavigateToSignIn={navigateToSignIn} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SignUpScreen", () => {
  it("renders the sign up form", () => {
    renderSignUp();
    expect(screen.getByText("Create your account")).toBeTruthy();
    expect(screen.getByText("Start building habits that stick")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("Create account")).toBeTruthy();
  });

  it("navigates to sign in when link is pressed", () => {
    renderSignUp();
    fireEvent.press(screen.getByText("Sign in"));
    expect(navigateToSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows username hint with public URL preview", () => {
    renderSignUp();
    expect(screen.getByText("This will be your public profile URL: winzy.ai/@you")).toBeTruthy();
  });

  it("updates username hint as user types", () => {
    renderSignUp();
    fireEvent.changeText(screen.getByTestId("username-input"), "alice");
    expect(
      screen.getByText("This will be your public profile URL: winzy.ai/@alice"),
    ).toBeTruthy();
  });

  it("lowercases username in URL preview hint", () => {
    renderSignUp();
    fireEvent.changeText(screen.getByTestId("username-input"), "Alice_B");
    expect(
      screen.getByText("This will be your public profile URL: winzy.ai/@alice_b"),
    ).toBeTruthy();
  });

  // --- Validation ---

  it("shows validation errors for empty fields on submit", async () => {
    renderSignUp();
    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });
    expect(screen.getByText("Email is required.")).toBeTruthy();
    expect(screen.getByText("Username is required.")).toBeTruthy();
    expect(screen.getByText("Password is required.")).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("validates email format", async () => {
    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "notanemail");
    fireEvent.changeText(screen.getByTestId("username-input"), "validuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });
    expect(screen.getByText("Please enter a valid email address.")).toBeTruthy();
  });

  it("validates username format — too short", async () => {
    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "ab");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });
    expect(screen.getByText("Username must be at least 3 characters.")).toBeTruthy();
  });

  it("validates username format — invalid characters", async () => {
    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "user name");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });
    expect(
      screen.getByText("Username can only contain letters, digits, hyphens, and underscores."),
    ).toBeTruthy();
  });

  it("validates password minimum length", async () => {
    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "validuser");
    fireEvent.changeText(screen.getByTestId("password-input"), "short");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });
    expect(screen.getByText("Password must be at least 8 characters.")).toBeTruthy();
  });

  it("clears field errors when user types", async () => {
    renderSignUp();
    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });
    expect(screen.getByText("Email is required.")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("email-input"), "a");
    expect(screen.queryByText("Email is required.")).toBeNull();
  });

  // --- API integration ---

  it("calls register on valid submit", async () => {
    api.post.mockResolvedValue({
      accessToken: "tok",
      refreshToken: "ref",
      user: { id: "1", email: "user@test.com", username: "alice" },
    });

    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "alice");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });

    expect(api.post).toHaveBeenCalledWith(
      "/auth/register",
      { email: "user@test.com", username: "alice", password: "password123", displayName: undefined },
      { noAuth: true },
    );
  });

  it("shows email conflict error inline", async () => {
    api.post.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Email already registered.",
    });

    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "taken@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "alice");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });

    await waitFor(() => {
      expect(screen.getByText("This email is already registered.")).toBeTruthy();
    });
  });

  it("shows username conflict error inline", async () => {
    api.post.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Username already taken.",
    });

    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "taken");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });

    await waitFor(() => {
      expect(
        screen.getByText("This username is already taken. Try another one."),
      ).toBeTruthy();
    });
  });

  it("shows server validation errors inline", async () => {
    api.post.mockRejectedValue({
      status: 422,
      code: "validation",
      message: "Please check your input.",
      validationErrors: {
        username: ["Username must be 3-64 characters: letters, digits, hyphens, underscores only."],
        password: ["Password must be at least 8 characters."],
      },
    });

    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "ok_user");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Username must be 3-64 characters: letters, digits, hyphens, underscores only.",
        ),
      ).toBeTruthy();
      expect(screen.getByText("Password must be at least 8 characters.")).toBeTruthy();
    });
  });

  it("shows network error", async () => {
    api.post.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Unable to reach the server.",
    });

    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "alice");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });

    await waitFor(() => {
      expect(
        screen.getByText("Unable to reach the server. Please check your connection."),
      ).toBeTruthy();
    });
  });

  it("clears server error when user types", async () => {
    api.post.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Unable to reach the server.",
    });

    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "alice");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("server-error")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("email-input"), "user2@test.com");
    expect(screen.queryByTestId("server-error")).toBeNull();
  });

  it("handles generic error gracefully", async () => {
    api.post.mockRejectedValue(new Error("unexpected"));

    renderSignUp();
    fireEvent.changeText(screen.getByTestId("email-input"), "user@test.com");
    fireEvent.changeText(screen.getByTestId("username-input"), "alice");
    fireEvent.changeText(screen.getByTestId("password-input"), "password123");

    await act(async () => {
      fireEvent.press(screen.getByText("Create account"));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy();
    });
  });
});
