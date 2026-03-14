import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { StatsScreen } from "../StatsScreen";

// --- Mocks ---

const mockHabit = {
  id: "habit-1",
  name: "Morning Run",
  icon: "\u{1F3C3}",
  color: "#F97316",
  frequency: "daily" as const,
  customDays: null,
  createdAt: "2026-01-01T00:00:00Z",
  archivedAt: null,
};

// 30 completed dates spread across last 60 days for a ~50% consistency
function generateCompletedDates(count: number, today: string): string[] {
  const dates: string[] = [];
  const end = new Date(today + "T12:00:00");
  for (let i = 0; i < count; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - i * 2); // every other day
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return dates.sort();
}

const today = "2026-03-12";
const completedDates30 = generateCompletedDates(30, today);

const mockStats = {
  habitId: "habit-1",
  consistency: 65.5,
  flameLevel: "strong" as const,
  totalCompletions: 42,
  completionsInWindow: 39,
  completedToday: true,
  windowDays: 60,
  windowStart: "2026-01-11",
  today,
  completedDates: completedDates30,
};

const mockFetchHabit = jest.fn();
const mockFetchHabitStats = jest.fn();

jest.mock("../../api/habits", () => ({
  fetchHabit: (...args: unknown[]) => mockFetchHabit(...args),
  fetchHabitStats: (...args: unknown[]) => mockFetchHabitStats(...args),
  completeHabit: jest.fn(),
  deleteCompletion: jest.fn(),
}));

jest.mock("../../api", () => ({
  isApiError: jest.requireActual("../../api/types").isApiError,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchHabit.mockResolvedValue(mockHabit);
  mockFetchHabitStats.mockResolvedValue(mockStats);
});

function renderStats(props: Partial<React.ComponentProps<typeof StatsScreen>> = {}) {
  return render(<StatsScreen habitId="habit-1" {...props} />);
}

describe("StatsScreen", () => {
  // --- 1. Happy path: renders consistency stats ---

  it("renders consistency stats (percentage, trend, best month)", async () => {
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });

    // Consistency percentage
    expect(screen.getByTestId("stats-consistency-value")).toBeTruthy();
    expect(screen.getByText("66%")).toBeTruthy(); // Math.round(65.5)

    // Window completions
    expect(screen.getByTestId("stats-window-completions")).toBeTruthy();
    expect(screen.getByText("39")).toBeTruthy();

    // Total completions
    expect(screen.getByTestId("stats-total-completions")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();

    // Consistency card rendered
    expect(screen.getByTestId("consistency-card")).toBeTruthy();
  });

  // --- 2. Happy path: calendar heatmap shows completion intensity ---

  it("renders calendar heatmap with completion data", async () => {
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("heatmap-card")).toBeTruthy();
    });

    expect(screen.getByTestId("calendar-heatmap")).toBeTruthy();
    expect(screen.getByText("Year Overview")).toBeTruthy();

    // Legend is present
    expect(screen.getByText("Less")).toBeTruthy();
    expect(screen.getByText("More")).toBeTruthy();
  });

  // --- 3. Happy path: insights section shows encouraging messages ---

  it("renders insights section with encouraging messages", async () => {
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    // Insights list rendered (not "Just getting started")
    expect(screen.getByTestId("insights-list")).toBeTruthy();

    // Best day insight
    expect(screen.getByTestId("insight-best-day")).toBeTruthy();

    // Total completions insight
    expect(screen.getByTestId("insight-total")).toBeTruthy();
    expect(screen.getByText(/42 total completions? all time/)).toBeTruthy();
  });

  // --- 4. Edge case: new habit with <7 days of data ---

  it("shows 'Just getting started' for habits with less than 7 days of data", async () => {
    // Only 3 completed dates, all within last 3 days
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: ["2026-03-10", "2026-03-11", "2026-03-12"],
      totalCompletions: 3,
      completionsInWindow: 3,
      consistency: 5,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    expect(screen.getByTestId("new-habit-message")).toBeTruthy();
    expect(screen.getByText(/Just getting started/)).toBeTruthy();
    expect(screen.queryByTestId("insights-list")).toBeNull();
  });

  // --- 5. Edge case: 0% consistency ---

  it("shows supportive empty state for 0% consistency, no punitive language", async () => {
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      consistency: 0,
      flameLevel: "none",
      totalCompletions: 0,
      completionsInWindow: 0,
      completedDates: [],
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });

    // Shows 0%
    expect(screen.getByText("0%")).toBeTruthy();

    // Encouraging message, not punitive
    expect(screen.getByTestId("stats-consistency-message")).toBeTruthy();
    const message = screen.getByTestId("stats-consistency-message");
    expect(message.props.children).toContain("Ready to build your habit? One day at a time.");

    // No punitive language
    const allText = JSON.stringify(screen.toJSON());
    expect(allText).not.toMatch(/failed/i);
    expect(allText).not.toMatch(/you haven't/i);
    expect(allText).not.toMatch(/missed/i);
    expect(allText).not.toMatch(/behind/i);
  });

  // --- 6. Edge case: 100% consistency ---

  it("shows blazing celebration for 100% consistency", async () => {
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      consistency: 100,
      flameLevel: "blazing",
      totalCompletions: 60,
      completionsInWindow: 60,
      completedDates: generateCompletedDates(60, today),
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });

    expect(screen.getByText("100%")).toBeTruthy();

    // Blazing celebration message
    expect(screen.getByText(/blazing/i)).toBeTruthy();
  });

  // --- 7. Edge case: weekly habit stats ---

  it("renders correctly for weekly habit frequency", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      frequency: "weekly",
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });

    // Shows "Weekly" badge
    expect(screen.getByText("Weekly")).toBeTruthy();

    // Stats still render
    expect(screen.getByTestId("consistency-card")).toBeTruthy();
    expect(screen.getByTestId("heatmap-card")).toBeTruthy();
  });

  // --- 8. Error condition: stats fetch failure ---

  it("shows ErrorState with retry on stats fetch failure", async () => {
    mockFetchHabit.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-error")).toBeTruthy();
    });

    expect(screen.getByText("Something went wrong on our end. Please try again.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  // --- 9. CRITICAL: NO streak language anywhere ---

  it("contains NO streak language anywhere on the stats screen", async () => {
    // Test with various consistency levels
    for (const consistency of [0, 25, 50, 75, 100]) {
      mockFetchHabitStats.mockResolvedValue({
        ...mockStats,
        consistency,
        flameLevel: consistency >= 85 ? "blazing" : consistency >= 65 ? "strong" : consistency >= 45 ? "steady" : consistency >= 10 ? "ember" : "none",
        completedDates: generateCompletedDates(Math.floor(consistency * 0.6), today),
      });

      const { unmount } = renderStats();
      await waitFor(() => {
        expect(screen.getByTestId("stats-screen")).toBeTruthy();
      });

      const allText = JSON.stringify(screen.toJSON());

      // Must NOT contain streak language
      expect(allText.toLowerCase()).not.toContain("streak");
      expect(allText.toLowerCase()).not.toContain("best streak");
      expect(allText.toLowerCase()).not.toContain("current streak");
      expect(allText.toLowerCase()).not.toContain("days in a row");
      expect(allText.toLowerCase()).not.toContain("consecutive");

      unmount();
    }
  });

  // --- Additional: renders habit header ---

  it("renders habit name, icon, and flame in the header", async () => {
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });

    expect(screen.getByText("Morning Run")).toBeTruthy();
    expect(screen.getByTestId("stats-flame")).toBeTruthy();
  });

  // --- Back button ---

  it("renders back button when onBack is provided", async () => {
    const onBack = jest.fn();
    renderStats({ onBack });
    await waitFor(() => {
      expect(screen.getByTestId("stats-back-button")).toBeTruthy();
    });
  });

  it("does not render back button when onBack is not provided", async () => {
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });
    expect(screen.queryByTestId("stats-back-button")).toBeNull();
  });

  // --- Loading state ---

  it("shows loading state initially", () => {
    mockFetchHabit.mockReturnValue(new Promise(() => {}));
    mockFetchHabitStats.mockReturnValue(new Promise(() => {}));
    renderStats();
    expect(screen.getByTestId("stats-loading")).toBeTruthy();
    expect(screen.getByText("Loading stats...")).toBeTruthy();
  });
});
