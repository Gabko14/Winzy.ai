import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";
import { PromiseSection } from "../PromiseSection";

// --- Mocks ---

const mockFetchPromise = jest.fn();
const mockCreatePromise = jest.fn();
const mockCancelPromise = jest.fn();

jest.mock("../../api/promises", () => ({
  fetchPromise: (...args: unknown[]) => mockFetchPromise(...args),
  createPromise: (...args: unknown[]) => mockCreatePromise(...args),
  cancelPromise: (...args: unknown[]) => mockCancelPromise(...args),
}));

jest.mock("../../api", () => ({
  isApiError: jest.requireActual("../../api/types").isApiError,
}));

const mockActivePromise = {
  id: "promise-1",
  habitId: "habit-1",
  targetConsistency: 70,
  endDate: "2026-04-30",
  privateNote: null,
  status: "active" as const,
  onTrack: true,
  currentConsistency: 75,
  statement: "Keeping above 70% through April 30",
  createdAt: "2026-03-15T00:00:00Z",
  resolvedAt: null,
};

const mockKeptPromise = {
  ...mockActivePromise,
  id: "promise-0",
  status: "kept" as const,
  onTrack: null,
  currentConsistency: null,
  statement: "Keeping above 70% through March 14",
  resolvedAt: "2026-03-14T00:00:00Z",
};

const mockEndedBelowPromise = {
  ...mockActivePromise,
  id: "promise-2",
  status: "endedbelow" as const,
  onTrack: null,
  currentConsistency: null,
  statement: "Keeping above 80% through March 1",
  resolvedAt: "2026-03-01T00:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreatePromise.mockResolvedValue(mockActivePromise);
  mockCancelPromise.mockResolvedValue(undefined);
});

function renderSection() {
  return render(<PromiseSection habitId="habit-1" timezone="UTC" />);
}

describe("PromiseSection", () => {
  // --- Happy path: no active promise ---

  it("shows create button when no active promise", async () => {
    mockFetchPromise.mockResolvedValue({ active: null, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Flame Promise")).toBeTruthy();
    });
    expect(screen.getByText("Make a promise to yourself about this habit")).toBeTruthy();
    expect(screen.getByText("Create promise")).toBeTruthy();
  });

  // --- Happy path: active promise ---

  it("shows active promise with on-track status", async () => {
    mockFetchPromise.mockResolvedValue({ active: mockActivePromise, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("active-promise")).toBeTruthy();
    });
    expect(screen.getByTestId("promise-statement")).toBeTruthy();
    expect(screen.getByText("Keeping above 70% through April 30")).toBeTruthy();
    expect(screen.getByText("On track")).toBeTruthy();
    expect(screen.getByText("Current: 75%")).toBeTruthy();
    expect(screen.getByText("Cancel promise")).toBeTruthy();
  });

  it("shows below target badge when not on track", async () => {
    mockFetchPromise.mockResolvedValue({
      active: { ...mockActivePromise, onTrack: false, currentConsistency: 50 },
      history: [],
    });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Below target")).toBeTruthy();
    });
    expect(screen.getByText("Current: 50%")).toBeTruthy();
  });

  it("shows private note when present", async () => {
    mockFetchPromise.mockResolvedValue({
      active: { ...mockActivePromise, privateNote: "Stay focused!" },
      history: [],
    });

    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("promise-private-note")).toBeTruthy();
    });
    expect(screen.getByText("Stay focused!")).toBeTruthy();
  });

  // --- Happy path: create promise flow ---

  it("shows form when create button is pressed", async () => {
    mockFetchPromise.mockResolvedValue({ active: null, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Create promise")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Create promise"));
    });

    expect(screen.getByTestId("create-promise-form")).toBeTruthy();
    expect(screen.getByTestId("promise-target-input")).toBeTruthy();
    expect(screen.getByTestId("promise-enddate-input")).toBeTruthy();
    expect(screen.getByText("Make promise")).toBeTruthy();
  });

  it("submits create form successfully", async () => {
    mockFetchPromise
      .mockResolvedValueOnce({ active: null, history: [] })
      .mockResolvedValueOnce({ active: mockActivePromise, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Create promise")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Create promise"));
    });

    fireEvent.changeText(screen.getByTestId("promise-target-input"), "70");
    fireEvent.changeText(screen.getByTestId("promise-enddate-input"), "2026-04-30");

    await act(async () => {
      fireEvent.press(screen.getByText("Make promise"));
    });

    expect(mockCreatePromise).toHaveBeenCalledWith("habit-1", {
      targetConsistency: 70,
      endDate: "2026-04-30",
      privateNote: undefined,
    }, "UTC");
  });

  // --- Happy path: cancel promise ---

  it("cancels promise on web without confirmation", async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });

    mockFetchPromise
      .mockResolvedValueOnce({ active: mockActivePromise, history: [] })
      .mockResolvedValueOnce({ active: null, history: [{ ...mockActivePromise, status: "cancelled" }] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Cancel promise")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Cancel promise"));
    });

    expect(mockCancelPromise).toHaveBeenCalledWith("habit-1");

    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  it("cancels promise on native with confirmation", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _msg, buttons) => {
      const cancelBtn = buttons?.find((b) => b.text === "Cancel promise");
      cancelBtn?.onPress?.();
    });
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "ios", writable: true });

    mockFetchPromise
      .mockResolvedValueOnce({ active: mockActivePromise, history: [] })
      .mockResolvedValueOnce({ active: null, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Cancel promise")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Cancel promise"));
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(mockCancelPromise).toHaveBeenCalledWith("habit-1");

    alertSpy.mockRestore();
    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  // --- Happy path: history ---

  it("shows promise history", async () => {
    mockFetchPromise.mockResolvedValue({
      active: null,
      history: [mockKeptPromise, mockEndedBelowPromise],
    });

    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("promise-history")).toBeTruthy();
    });
    expect(screen.getByText("Past promises")).toBeTruthy();
    expect(screen.getByText("Kept")).toBeTruthy();
    expect(screen.getByText("Ended below promise")).toBeTruthy();
  });

  it("does not show history section when empty", async () => {
    mockFetchPromise.mockResolvedValue({ active: null, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Flame Promise")).toBeTruthy();
    });
    expect(screen.queryByTestId("promise-history")).toBeNull();
  });

  // --- Edge cases: supportive copy ---

  it("uses supportive language — never punitive", async () => {
    mockFetchPromise.mockResolvedValue({
      active: null,
      history: [mockEndedBelowPromise],
    });

    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("promise-history")).toBeTruthy();
    });

    // Verify no punitive language
    expect(screen.queryByText(/fail/i)).toBeNull();
    expect(screen.queryByText(/broke/i)).toBeNull();
    expect(screen.queryByText(/missed/i)).toBeNull();
    // Verify supportive framing
    expect(screen.getByText("Ended below promise")).toBeTruthy();
  });

  it("uses no streak language anywhere", async () => {
    mockFetchPromise.mockResolvedValue({
      active: mockActivePromise,
      history: [mockKeptPromise],
    });

    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("active-promise")).toBeTruthy();
    });

    expect(screen.queryByText(/streak/i)).toBeNull();
    expect(screen.queryByText(/days in a row/i)).toBeNull();
  });

  // --- Edge cases: form validation ---

  it("shows error for invalid target", async () => {
    mockFetchPromise.mockResolvedValue({ active: null, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Create promise")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Create promise"));
    });

    fireEvent.changeText(screen.getByTestId("promise-target-input"), "0");
    fireEvent.changeText(screen.getByTestId("promise-enddate-input"), "2026-04-30");

    await act(async () => {
      fireEvent.press(screen.getByText("Make promise"));
    });

    expect(screen.getByTestId("promise-form-error")).toBeTruthy();
    expect(screen.getByText("Target must be between 1% and 100%")).toBeTruthy();
    expect(mockCreatePromise).not.toHaveBeenCalled();
  });

  it("shows error for missing end date", async () => {
    mockFetchPromise.mockResolvedValue({ active: null, history: [] });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Create promise")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Create promise"));
    });

    fireEvent.changeText(screen.getByTestId("promise-target-input"), "70");
    // Don't set end date

    await act(async () => {
      fireEvent.press(screen.getByText("Make promise"));
    });

    expect(screen.getByTestId("promise-form-error")).toBeTruthy();
    expect(screen.getByText("Please set an end date")).toBeTruthy();
  });

  // --- Error conditions ---

  it("shows error from API on create failure", async () => {
    mockFetchPromise.mockResolvedValue({ active: null, history: [] });
    mockCreatePromise.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "An active promise already exists for this habit",
    });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("Create promise")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Create promise"));
    });

    fireEvent.changeText(screen.getByTestId("promise-target-input"), "70");
    fireEvent.changeText(screen.getByTestId("promise-enddate-input"), "2026-04-30");

    await act(async () => {
      fireEvent.press(screen.getByText("Make promise"));
    });

    expect(screen.getByTestId("promise-form-error")).toBeTruthy();
    expect(screen.getByText("An active promise already exists for this habit")).toBeTruthy();
  });

  it("fails silently when fetch errors on mount", async () => {
    mockFetchPromise.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    renderSection();

    // Should not crash — renders nothing
    await waitFor(() => {
      expect(screen.queryByText("Flame Promise")).toBeNull();
    });
  });
});
