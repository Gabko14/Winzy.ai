import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { HabitListScreen } from "../HabitListScreen";

jest.mock("../../api/habits", () => ({
  fetchHabits: jest.fn(),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  archiveHabit: jest.fn(),
}));

jest.mock("../../api/visibility", () => ({
  fetchVisibility: jest.fn(),
  fetchPreferences: jest.fn().mockResolvedValue({ defaultHabitVisibility: "private" }),
  updateVisibility: jest.fn().mockResolvedValue({ habitId: "h1", visibility: "private" }),
}));

jest.mock("../../api", () => ({
  isApiError: jest.requireActual("../../api/types").isApiError,
}));

const { fetchHabits, archiveHabit } = jest.requireMock("../../api/habits");
const { fetchVisibility } = jest.requireMock("../../api/visibility");

const mockHabits = [
  {
    id: "h1",
    name: "Morning run",
    icon: "\uD83C\uDFC3",
    color: "#F97316",
    frequency: "daily",
    customDays: null,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
  },
  {
    id: "h2",
    name: "Read",
    icon: "\uD83D\uDCD6",
    color: "#3B82F6",
    frequency: "weekly",
    customDays: null,
    createdAt: "2026-01-02T00:00:00Z",
    archivedAt: null,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  fetchVisibility.mockResolvedValue({
    defaultVisibility: "private",
    habits: [],
  });
});

describe("HabitListScreen", () => {
  // --- Happy path ---

  it("renders loading state initially", () => {
    fetchHabits.mockReturnValue(new Promise(() => {})); // never resolves
    render(<HabitListScreen />);
    expect(screen.getByTestId("habits-loading")).toBeTruthy();
  });

  it("renders habits list after loading", async () => {
    fetchHabits.mockResolvedValue(mockHabits);
    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("habit-list-screen")).toBeTruthy();
    });

    expect(screen.getByText("Morning run")).toBeTruthy();
    expect(screen.getByText("Read")).toBeTruthy();
    expect(screen.getByText("My Habits")).toBeTruthy();
  });

  it("renders empty state when no habits", async () => {
    fetchHabits.mockResolvedValue([]);
    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByText("No habits yet")).toBeTruthy();
    });

    expect(screen.getByText("Create your first habit")).toBeTruthy();
  });

  it("shows frequency label for each habit", async () => {
    fetchHabits.mockResolvedValue(mockHabits);
    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByText("Every day")).toBeTruthy();
      expect(screen.getByText("Weekly")).toBeTruthy();
    });
  });

  it("shows custom days for custom frequency habits", async () => {
    fetchHabits.mockResolvedValue([
      {
        ...mockHabits[0],
        frequency: "custom",
        customDays: [1, 3, 5],
      },
    ]);
    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByText("Mon, Wed, Fri")).toBeTruthy();
    });
  });

  // --- Visibility badges ---

  it("shows visibility badge on habit items", async () => {
    fetchHabits.mockResolvedValue(mockHabits);
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "private",
      habits: [
        { habitId: "h1", visibility: "friends" },
        { habitId: "h2", visibility: "public" },
      ],
    });

    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("visibility-badge-h1")).toBeTruthy();
      expect(screen.getByTestId("visibility-badge-h2")).toBeTruthy();
    });

    // Check badge labels
    expect(screen.getByTestId("visibility-badge-h1")).toBeTruthy();
    expect(screen.getByTestId("visibility-badge-h2")).toBeTruthy();
  });

  it("shows default visibility badge when no per-habit setting exists", async () => {
    fetchHabits.mockResolvedValue([mockHabits[0]]);
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "private",
      habits: [],
    });

    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("visibility-badge-h1")).toBeTruthy();
    });
  });

  it("does not show visibility badges when fetch fails", async () => {
    fetchHabits.mockResolvedValue(mockHabits);
    fetchVisibility.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByText("Morning run")).toBeTruthy();
    });

    // Badges should not be rendered when visibility fetch fails
    expect(screen.queryByTestId("visibility-badge-h1")).toBeNull();
  });

  // --- Create habit ---

  it("opens create modal from empty state action", async () => {
    fetchHabits.mockResolvedValue([]);
    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByText("Create your first habit")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Create your first habit"));

    await waitFor(() => {
      expect(screen.getByText("New Habit")).toBeTruthy();
    });
  });

  it("opens create modal from header button", async () => {
    fetchHabits.mockResolvedValue(mockHabits);
    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByText("+ New")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("+ New"));

    await waitFor(() => {
      expect(screen.getByText("New Habit")).toBeTruthy();
    });
  });

  // --- Edit habit ---

  it("opens edit modal when habit is tapped", async () => {
    fetchHabits.mockResolvedValue(mockHabits);
    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("habit-h1")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("habit-h1"));

    await waitFor(() => {
      expect(screen.getByText("Edit Habit")).toBeTruthy();
    });
  });

  // --- Archive habit ---

  it("calls archive API when archive button is pressed (web)", async () => {
    // Mock window.confirm for web
    const originalConfirm = global.window?.confirm;
    Object.defineProperty(global, "window", {
      value: { confirm: jest.fn().mockReturnValue(true) },
      writable: true,
    });

    fetchHabits.mockResolvedValue(mockHabits);
    archiveHabit.mockResolvedValue(undefined);

    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("archive-h1")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId("archive-h1"));
    });

    // Restore
    if (originalConfirm) {
      Object.defineProperty(global, "window", {
        value: { confirm: originalConfirm },
        writable: true,
      });
    }
  });

  // --- Error state ---

  it("renders error state on fetch failure", async () => {
    fetchHabits.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("habits-error")).toBeTruthy();
    });
  });

  it("retries fetch when retry is pressed on error state", async () => {
    fetchHabits.mockRejectedValueOnce({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    render(<HabitListScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("habits-error")).toBeTruthy();
    });

    fetchHabits.mockResolvedValue(mockHabits);

    await act(async () => {
      fireEvent.press(screen.getByText("Try again"));
    });

    await waitFor(() => {
      expect(screen.getByText("Morning run")).toBeTruthy();
    });
  });
});
