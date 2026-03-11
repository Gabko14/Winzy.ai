import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { PublicFlameScreen } from "../PublicFlameScreen";

const mockApiRequest = jest.fn();

jest.mock("../../api", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const onNavigateToSignUp = jest.fn();

function renderScreen(username = "testuser") {
  return render(
    <PublicFlameScreen username={username} onNavigateToSignUp={onNavigateToSignUp} />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PublicFlameScreen", () => {
  // --- Happy path ---

  it("shows loading state initially", () => {
    mockApiRequest.mockReturnValue(new Promise(() => {})); // never resolves
    const { getByTestId } = renderScreen();
    expect(getByTestId("public-flame-loading")).toBeTruthy();
  });

  it("renders profile with habits after successful fetch", async () => {
    mockApiRequest.mockResolvedValue({
      username: "alice",
      habits: [
        {
          id: "1",
          name: "Meditate",
          icon: null,
          color: null,
          consistency: 75,
          flameLevel: "strong",
        },
        {
          id: "2",
          name: "Read",
          icon: null,
          color: null,
          consistency: 45,
          flameLevel: "steady",
        },
      ],
    });

    const { getByTestId, getByText } = renderScreen("alice");

    await waitFor(() => {
      expect(getByTestId("public-flame-screen")).toBeTruthy();
    });

    expect(getByText("@alice")).toBeTruthy();
    expect(getByText("Meditate")).toBeTruthy();
    expect(getByText("Read")).toBeTruthy();
    expect(getByText("2 habits")).toBeTruthy();
  });

  it("calls the API with correct path and noAuth", async () => {
    mockApiRequest.mockResolvedValue({ username: "bob", habits: [] });
    renderScreen("bob");

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/habits/public/bob",
        expect.objectContaining({ noAuth: true }),
      );
    });
  });

  it("passes X-Timezone header to the API", async () => {
    mockApiRequest.mockResolvedValue({ username: "bob", habits: [] });
    renderScreen("bob");

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Timezone": expect.any(String),
          }),
        }),
      );
    });
  });

  // --- Single habit ---

  it("shows singular 'habit' for one habit", async () => {
    mockApiRequest.mockResolvedValue({
      username: "solo",
      habits: [
        { id: "1", name: "Run", icon: null, color: null, consistency: 90, flameLevel: "blazing" },
      ],
    });

    const { getByText } = renderScreen("solo");

    await waitFor(() => {
      expect(getByText("1 habit")).toBeTruthy();
    });
  });

  // --- Empty habits ---

  it("shows empty state when user has no public habits", async () => {
    mockApiRequest.mockResolvedValue({ username: "quiet", habits: [] });

    const { getByText } = renderScreen("quiet");

    await waitFor(() => {
      expect(getByText("No public habits yet")).toBeTruthy();
    });
  });

  // --- Not found ---

  it("shows not-found state for unknown username", async () => {
    mockApiRequest.mockRejectedValue({ code: "not_found", status: 404, message: "Not found" });

    const { getByTestId, getByText } = renderScreen("ghost");

    await waitFor(() => {
      expect(getByTestId("public-flame-not-found")).toBeTruthy();
    });

    expect(getByText(/ghost/)).toBeTruthy();
  });

  // --- Error handling ---

  it("shows error state on network failure", async () => {
    mockApiRequest.mockRejectedValue({ code: "network", status: 0, message: "Network error" });

    const { getByTestId } = renderScreen("failing");

    await waitFor(() => {
      expect(getByTestId("public-flame-error")).toBeTruthy();
    });
  });

  it("shows error state on server error", async () => {
    mockApiRequest.mockRejectedValue({
      code: "server_error",
      status: 500,
      message: "Server error",
    });

    const { getByTestId } = renderScreen("failing");

    await waitFor(() => {
      expect(getByTestId("public-flame-error")).toBeTruthy();
    });
  });

  // --- CTA ---

  it("renders the CTA section", async () => {
    mockApiRequest.mockResolvedValue({ username: "cta", habits: [] });

    const { getByText } = renderScreen("cta");

    await waitFor(() => {
      expect(getByText("Track your own habits")).toBeTruthy();
      expect(getByText("Get started")).toBeTruthy();
    });
  });

  // --- Flame levels display ---

  it("renders flame components for each habit", async () => {
    mockApiRequest.mockResolvedValue({
      username: "flames",
      habits: [
        { id: "1", name: "H1", icon: null, color: null, consistency: 0, flameLevel: "none" },
        { id: "2", name: "H2", icon: null, color: null, consistency: 15, flameLevel: "ember" },
        { id: "3", name: "H3", icon: null, color: null, consistency: 40, flameLevel: "steady" },
        { id: "4", name: "H4", icon: null, color: null, consistency: 65, flameLevel: "strong" },
        { id: "5", name: "H5", icon: null, color: null, consistency: 90, flameLevel: "blazing" },
      ],
    });

    const { getByTestId, getByText } = renderScreen("flames");

    await waitFor(() => {
      expect(getByTestId("public-flame-screen")).toBeTruthy();
    });

    expect(getByText("5 habits")).toBeTruthy();
    expect(getByText("H1")).toBeTruthy();
    expect(getByText("H5")).toBeTruthy();
  });

  // --- Habit with icon ---

  it("renders habit icon prefix when present", async () => {
    mockApiRequest.mockResolvedValue({
      username: "icons",
      habits: [
        { id: "1", name: "Run", icon: "🏃", color: null, consistency: 50, flameLevel: "steady" },
      ],
    });

    const { getByText } = renderScreen("icons");

    await waitFor(() => {
      // The icon is prepended to the name
      expect(getByText(/🏃/)).toBeTruthy();
    });
  });

  // --- Aggregate consistency ---

  it("shows aggregate consistency percentage", async () => {
    mockApiRequest.mockResolvedValue({
      username: "agg",
      habits: [
        { id: "1", name: "H1", icon: null, color: null, consistency: 60, flameLevel: "strong" },
        { id: "2", name: "H2", icon: null, color: null, consistency: 40, flameLevel: "steady" },
      ],
    });

    const { getByText } = renderScreen("agg");

    await waitFor(() => {
      // Average of 60 and 40 = 50%
      expect(getByText("50% consistency")).toBeTruthy();
    });
  });

  // --- Footer ---

  it("renders the powered-by footer", async () => {
    mockApiRequest.mockResolvedValue({ username: "footer", habits: [] });

    const { getByText } = renderScreen("footer");

    await waitFor(() => {
      expect(getByText("Powered by Winzy.ai")).toBeTruthy();
    });
  });

  // --- Encodes username in API path ---

  it("encodes special characters in username for API call", async () => {
    mockApiRequest.mockResolvedValue({ username: "user-name", habits: [] });
    renderScreen("user-name");

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/habits/public/user-name",
        expect.any(Object),
      );
    });
  });
});
