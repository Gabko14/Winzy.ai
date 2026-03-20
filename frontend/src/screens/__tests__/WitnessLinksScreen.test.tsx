import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import { WitnessLinksScreen } from "../WitnessLinksScreen";
import type { WitnessLink } from "../../api/witnessLinks";
import type { Habit } from "../../api/habits";

// Mock witness links API
const mockListWitnessLinks = jest.fn();
const mockCreateWitnessLink = jest.fn();
const mockRevokeWitnessLink = jest.fn();
const mockRotateWitnessLink = jest.fn();
const mockUpdateWitnessLink = jest.fn();

jest.mock("../../api/witnessLinks", () => ({
  listWitnessLinks: (...args: unknown[]) => mockListWitnessLinks(...args),
  createWitnessLink: (...args: unknown[]) => mockCreateWitnessLink(...args),
  revokeWitnessLink: (...args: unknown[]) => mockRevokeWitnessLink(...args),
  rotateWitnessLink: (...args: unknown[]) => mockRotateWitnessLink(...args),
  updateWitnessLink: (...args: unknown[]) => mockUpdateWitnessLink(...args),
}));

// Mock habits API
const mockFetchHabits = jest.fn();
jest.mock("../../api/habits", () => ({
  fetchHabits: (...args: unknown[]) => mockFetchHabits(...args),
}));

// Mock api barrel for isApiError
jest.mock("../../api", () => ({
  isApiError: (value: unknown) =>
    typeof value === "object" && value !== null && "status" in value && "code" in value && "message" in value,
}));

jest.spyOn(Alert, "alert");

const onBack = jest.fn();

function makeLink(overrides: Partial<WitnessLink> = {}): WitnessLink {
  return {
    id: "link-" + Math.random().toString(36).slice(2, 8),
    token: "token-" + Math.random().toString(36).slice(2, 8),
    label: "Test Link",
    habitIds: ["h1"],
    createdAt: "2026-03-20T00:00:00Z",
    ...overrides,
  };
}

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h-" + Math.random().toString(36).slice(2, 8),
    name: "Test Habit",
    icon: null,
    color: null,
    frequency: "daily",
    customDays: null,
    minimumDescription: null,
    createdAt: "2026-03-01T00:00:00Z",
    archivedAt: null,
    ...overrides,
  };
}

function renderScreen() {
  return render(<WitnessLinksScreen onBack={onBack} />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("WitnessLinksScreen", () => {
  // --- Loading ---

  it("shows loading state initially", () => {
    mockListWitnessLinks.mockReturnValue(new Promise(() => {}));
    mockFetchHabits.mockReturnValue(new Promise(() => {}));

    const { getByTestId } = renderScreen();
    expect(getByTestId("witness-links-loading")).toBeTruthy();
  });

  // --- Happy path: list links ---

  it("renders list of witness links after successful fetch", async () => {
    const link1 = makeLink({ id: "l1", label: "Maya" });
    const link2 = makeLink({ id: "l2", label: "Coach Sam", habitIds: ["h1", "h2"] });

    mockListWitnessLinks.mockResolvedValue({ items: [link1, link2] });
    mockFetchHabits.mockResolvedValue([makeHabit()]);

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-links-screen")).toBeTruthy();
    });

    expect(getByText("Maya")).toBeTruthy();
    expect(getByText("Coach Sam")).toBeTruthy();
  });

  it("shows empty state when no links exist", async () => {
    mockListWitnessLinks.mockResolvedValue({ items: [] });
    mockFetchHabits.mockResolvedValue([]);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("No witness links yet")).toBeTruthy();
    });
  });

  it("shows habit count per link", async () => {
    const link = makeLink({ id: "l1", habitIds: ["h1", "h2", "h3"] });
    mockListWitnessLinks.mockResolvedValue({ items: [link] });
    mockFetchHabits.mockResolvedValue([]);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("3 habits")).toBeTruthy();
    });
  });

  it("shows singular 'habit' for one habit", async () => {
    const link = makeLink({ id: "l1", habitIds: ["h1"] });
    mockListWitnessLinks.mockResolvedValue({ items: [link] });
    mockFetchHabits.mockResolvedValue([]);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("1 habit")).toBeTruthy();
    });
  });

  it("shows 'Unnamed link' when label is null", async () => {
    const link = makeLink({ id: "l1", label: null });
    mockListWitnessLinks.mockResolvedValue({ items: [link] });
    mockFetchHabits.mockResolvedValue([]);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("Unnamed link")).toBeTruthy();
    });
  });

  // --- Error state ---

  it("shows error state on load failure", async () => {
    mockListWitnessLinks.mockRejectedValue({ status: 500, code: "server_error", message: "Server error" });
    mockFetchHabits.mockResolvedValue([]);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-links-error")).toBeTruthy();
    });
  });

  // --- Navigation ---

  it("calls onBack when back button is pressed", async () => {
    mockListWitnessLinks.mockResolvedValue({ items: [] });
    mockFetchHabits.mockResolvedValue([]);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId("witness-links-screen")).toBeTruthy();
    });

    fireEvent.press(getByTestId("witness-links-back"));
    expect(onBack).toHaveBeenCalled();
  });

  // --- Create link ---

  it("opens create modal and creates a link", async () => {
    const habit = makeHabit({ id: "h1", name: "Meditate" });
    mockListWitnessLinks.mockResolvedValue({ items: [] });
    mockFetchHabits.mockResolvedValue([habit]);

    const newLink = makeLink({ id: "new-link", label: "Maya", habitIds: ["h1"] });
    mockCreateWitnessLink.mockResolvedValue(newLink);

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByText("Create witness link")).toBeTruthy();
    });

    // Open create modal
    fireEvent.press(getByText("Create witness link"));

    // Fill label
    const labelInput = getByTestId("create-link-label");
    fireEvent.changeText(labelInput, "Maya");

    // Select habit
    fireEvent.press(getByTestId(`create-habit-${habit.id}`));

    // Submit
    fireEvent.press(getByText("Create link"));

    await waitFor(() => {
      expect(mockCreateWitnessLink).toHaveBeenCalledWith({
        label: "Maya",
        habitIds: ["h1"],
      });
    });

    // New link appears in list
    await waitFor(() => {
      expect(getByText("Maya")).toBeTruthy();
    });
  });

  it("shows error when create fails", async () => {
    mockListWitnessLinks.mockResolvedValue({ items: [] });
    mockFetchHabits.mockResolvedValue([makeHabit()]);
    mockCreateWitnessLink.mockRejectedValue({ status: 400, code: "validation", message: "Label too long" });

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByText("Create witness link")).toBeTruthy();
    });

    fireEvent.press(getByText("Create witness link"));
    fireEvent.press(getByText("Create link"));

    await waitFor(() => {
      expect(getByTestId("create-link-error")).toBeTruthy();
    });
  });

  // --- Revoke ---

  it("confirms before revoking a link", async () => {
    const link = makeLink({ id: "l1", label: "Maya" });
    mockListWitnessLinks.mockResolvedValue({ items: [link] });
    mockFetchHabits.mockResolvedValue([]);
    mockRevokeWitnessLink.mockResolvedValue(undefined);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId(`revoke-link-${link.id}`)).toBeTruthy();
    });

    fireEvent.press(getByTestId(`revoke-link-${link.id}`));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Revoke witness link?",
      expect.stringContaining("Maya"),
      expect.any(Array),
    );

    // Simulate pressing "Revoke" in the alert
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const revokeButton = alertCall[2].find((b: { text: string }) => b.text === "Revoke");
    await act(async () => {
      await revokeButton.onPress();
    });

    expect(mockRevokeWitnessLink).toHaveBeenCalledWith(link.id);
  });

  // --- Rotate ---

  it("confirms before rotating a link token", async () => {
    const link = makeLink({ id: "l1", label: "Maya", token: "old-token" });
    mockListWitnessLinks.mockResolvedValue({ items: [link] });
    mockFetchHabits.mockResolvedValue([]);

    const rotated = { ...link, token: "new-token" };
    mockRotateWitnessLink.mockResolvedValue(rotated);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId(`rotate-link-${link.id}`)).toBeTruthy();
    });

    fireEvent.press(getByTestId(`rotate-link-${link.id}`));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Rotate token?",
      expect.stringContaining("Maya"),
      expect.any(Array),
    );

    // Simulate pressing "Rotate" in the alert
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const rotateButton = alertCall[2].find((b: { text: string }) => b.text === "Rotate");
    await act(async () => {
      await rotateButton.onPress();
    });

    expect(mockRotateWitnessLink).toHaveBeenCalledWith(link.id);
  });

  // --- Edit ---

  it("opens edit modal with pre-filled values", async () => {
    const habit1 = makeHabit({ id: "h1", name: "Meditate" });
    const habit2 = makeHabit({ id: "h2", name: "Read" });
    const link = makeLink({ id: "l1", label: "Maya", habitIds: ["h1"] });

    mockListWitnessLinks.mockResolvedValue({ items: [link] });
    mockFetchHabits.mockResolvedValue([habit1, habit2]);

    const updated = { ...link, label: "Coach Sam", habitIds: ["h2"] };
    mockUpdateWitnessLink.mockResolvedValue(updated);

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId(`edit-link-${link.id}`)).toBeTruthy();
    });

    fireEvent.press(getByTestId(`edit-link-${link.id}`));

    // Change label
    const labelInput = getByTestId("edit-link-label");
    fireEvent.changeText(labelInput, "Coach Sam");

    // Toggle habits (deselect h1, select h2)
    fireEvent.press(getByTestId("edit-habit-h1"));
    fireEvent.press(getByTestId("edit-habit-h2"));

    // Save
    fireEvent.press(getByText("Save changes"));

    await waitFor(() => {
      expect(mockUpdateWitnessLink).toHaveBeenCalledWith("l1", {
        label: "Coach Sam",
        habitIds: ["h2"],
      });
    });
  });

  // --- Filters archived habits ---

  it("does not show archived habits in selection", async () => {
    const active = makeHabit({ id: "h1", name: "Active Habit", archivedAt: null });
    const archived = makeHabit({ id: "h2", name: "Archived Habit", archivedAt: "2026-03-15T00:00:00Z" });

    mockListWitnessLinks.mockResolvedValue({ items: [] });
    mockFetchHabits.mockResolvedValue([active, archived]);

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => {
      expect(getByText("Create witness link")).toBeTruthy();
    });

    // Open create modal to see habit list
    fireEvent.press(getByText("Create witness link"));

    expect(getByText("Active Habit")).toBeTruthy();
    expect(queryByText("Archived Habit")).toBeNull();
  });

  // --- Description text ---

  it("shows descriptive text about witness links", async () => {
    mockListWitnessLinks.mockResolvedValue({ items: [] });
    mockFetchHabits.mockResolvedValue([]);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText(/Share a private link/)).toBeTruthy();
    });
  });
});
