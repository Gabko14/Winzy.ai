import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { WitnessViewerScreen } from "../WitnessViewerScreen";

const mockFetchWitnessView = jest.fn();

jest.mock("../../api/witnessLinks", () => ({
  fetchWitnessView: (...args: unknown[]) => mockFetchWitnessView(...args),
}));

const onNavigateToSignUp = jest.fn();

function renderScreen(token = "test-token") {
  return render(
    <WitnessViewerScreen token={token} onNavigateToSignUp={onNavigateToSignUp} />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("WitnessViewerScreen", () => {
  // --- Happy path ---

  it("shows loading state initially", () => {
    mockFetchWitnessView.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = renderScreen();
    expect(getByTestId("witness-viewer-loading")).toBeTruthy();
  });

  it("renders witness page with habits after successful fetch", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "alice",
      ownerDisplayName: "Alice",
      habits: [
        { id: "1", name: "Meditate", icon: null, color: null, consistency: 75, flameLevel: "strong" },
        { id: "2", name: "Read", icon: null, color: null, consistency: 45, flameLevel: "steady" },
      ],
      habitsUnavailable: false,
    });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-viewer-screen")).toBeTruthy();
    });

    expect(getByText("Alice")).toBeTruthy();
    expect(getByText("Meditate")).toBeTruthy();
    expect(getByText("Read")).toBeTruthy();
  });

  it("calls API with correct token and noAuth", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "bob",
      ownerDisplayName: null,
      habits: [],
      habitsUnavailable: false,
    });

    renderScreen("my-secret-token");

    await waitFor(() => {
      expect(mockFetchWitnessView).toHaveBeenCalledWith("my-secret-token");
    });
  });

  it("shows supportive copy", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "alice",
      ownerDisplayName: "Alice",
      habits: [
        { id: "1", name: "Run", icon: null, color: null, consistency: 80, flameLevel: "blazing" },
      ],
      habitsUnavailable: false,
    });

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("is building better habits")).toBeTruthy();
    });
  });

  // --- Owner identity display ---

  it("shows display name when available", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "alice",
      ownerDisplayName: "Alice Smith",
      habits: [],
      habitsUnavailable: false,
    });

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-owner-name").props.children).toBe("Alice Smith");
    });
  });

  it("falls back to @username when no display name", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "bob",
      ownerDisplayName: null,
      habits: [],
      habitsUnavailable: false,
    });

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-owner-name").props.children).toBe("@bob");
    });
  });

  it("falls back to 'Someone' when no username or display name", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: null,
      ownerDisplayName: null,
      habits: [],
      habitsUnavailable: false,
    });

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-owner-name").props.children).toBe("Someone");
    });
  });

  // --- Empty habits ---

  it("shows empty state when no habits are shared", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "quiet",
      ownerDisplayName: null,
      habits: [],
      habitsUnavailable: false,
    });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-viewer-empty")).toBeTruthy();
    });

    expect(getByText("No habits shared yet")).toBeTruthy();
  });

  // --- Degraded state ---

  it("shows degraded banner when habits unavailable and empty", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "degraded",
      ownerDisplayName: null,
      habits: [],
      habitsUnavailable: true,
    });

    const { getByTestId, getByText, queryByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-viewer-degraded")).toBeTruthy();
    });

    expect(getByText("Temporarily unavailable")).toBeTruthy();
    expect(queryByText("No habits shared yet")).toBeNull();
  });

  it("shows habits normally when degraded but habits exist", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "partial",
      ownerDisplayName: null,
      habits: [
        { id: "1", name: "Yoga", icon: null, color: null, consistency: 60, flameLevel: "strong" },
      ],
      habitsUnavailable: true,
    });

    const { getByTestId, getByText, queryByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-viewer-screen")).toBeTruthy();
    });

    expect(getByText("Yoga")).toBeTruthy();
    expect(queryByTestId("witness-viewer-degraded")).toBeNull();
  });

  // --- Not available (revoked/invalid token) ---

  it("shows not-available state for revoked token", async () => {
    mockFetchWitnessView.mockRejectedValue({ code: "not_found", status: 404, message: "Not found" });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-viewer-not-available")).toBeTruthy();
    });

    expect(getByText("This link is not available")).toBeTruthy();
    expect(getByText(/may have been revoked/)).toBeTruthy();
  });

  it("shows same not-available state for invalid token (no info leakage)", async () => {
    mockFetchWitnessView.mockRejectedValue({ code: "not_found", status: 404, message: "Not found" });

    const { getByTestId } = renderScreen("invalid-garbage-token");

    await waitFor(() => {
      expect(getByTestId("witness-viewer-not-available")).toBeTruthy();
    });
  });

  // --- Error handling ---

  it("shows error state on network failure", async () => {
    mockFetchWitnessView.mockRejectedValue({ code: "network", status: 0, message: "Network error" });

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-viewer-error")).toBeTruthy();
    });
  });

  it("shows error state on server error", async () => {
    mockFetchWitnessView.mockRejectedValue({ code: "server_error", status: 500, message: "Internal" });

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-viewer-error")).toBeTruthy();
    });
  });

  // --- CTA ---

  it("renders CTA section", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "cta",
      ownerDisplayName: null,
      habits: [],
      habitsUnavailable: false,
    });

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("Track your own habits")).toBeTruthy();
      expect(getByText("Get started")).toBeTruthy();
    });
  });

  // --- Aggregate consistency ---

  it("shows aggregate consistency percentage", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "agg",
      ownerDisplayName: null,
      habits: [
        { id: "1", name: "H1", icon: null, color: null, consistency: 60, flameLevel: "strong" },
        { id: "2", name: "H2", icon: null, color: null, consistency: 40, flameLevel: "steady" },
      ],
      habitsUnavailable: false,
    });

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("50% consistency")).toBeTruthy();
    });
  });

  // --- Habit with icon ---

  it("renders habit icon prefix when present", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "icons",
      ownerDisplayName: null,
      habits: [
        { id: "1", name: "Run", icon: "\uD83C\uDFC3", color: null, consistency: 50, flameLevel: "steady" },
      ],
      habitsUnavailable: false,
    });

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText(/\uD83C\uDFC3/)).toBeTruthy();
    });
  });

  // --- Footer ---

  it("renders the powered-by footer", async () => {
    mockFetchWitnessView.mockResolvedValue({
      ownerUsername: "footer",
      ownerDisplayName: null,
      habits: [],
      habitsUnavailable: false,
    });

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("Powered by Winzy.ai")).toBeTruthy();
    });
  });
});
