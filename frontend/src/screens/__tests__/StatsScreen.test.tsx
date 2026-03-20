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
  minimumDescription: null as string | null,
  createdAt: "2026-01-01T00:00:00Z",
  archivedAt: null,
};

type CompletionEntry = { date: string; completionKind: "full" | "minimum" };

// 30 completed dates spread across last 60 days for a ~50% consistency
function generateCompletedDates(count: number, today: string, kind: "full" | "minimum" = "full"): CompletionEntry[] {
  const entries: CompletionEntry[] = [];
  const end = new Date(today + "T12:00:00");
  for (let i = 0; i < count; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - i * 2); // every other day
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    entries.push({ date: `${y}-${m}-${day}`, completionKind: kind });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
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
  completedTodayKind: "full" as string | null,
  windowDays: 60,
  windowStart: "2026-01-11",
  today,
  completedDates: completedDates30,
};

/** Convert date strings to CompletionDateEntry[] for test mocks */
function fullDates(...dates: string[]): CompletionEntry[] {
  return dates.map(d => ({ date: d, completionKind: "full" as const }));
}

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
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("Full")).toBeTruthy();
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
    // Habit created 3 days ago — daysOfData uses createdAt, not first completion
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      createdAt: "2026-03-10T00:00:00Z",
    });
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: fullDates("2026-03-10", "2026-03-11", "2026-03-12"),
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

  // --- Regression: days-of-data uses habit age, not first completion ---

  it("uses habit createdAt for days-of-data, not first completion date", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      createdAt: "2026-02-10T00:00:00Z",
    });
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: fullDates("2026-03-10", "2026-03-12"),
      totalCompletions: 2,
      completionsInWindow: 2,
      consistency: 5,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });

    expect(screen.queryByTestId("new-habit-message")).toBeNull();
    expect(screen.getByTestId("sparse-habit-message")).toBeTruthy();
    expect(screen.getByText(/Building up data/)).toBeTruthy();
  });

  it("habit with zero completions still shows as new if created < 7 days ago", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      createdAt: "2026-03-09T00:00:00Z",
    });
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: [],
      totalCompletions: 0,
      completionsInWindow: 0,
      consistency: 0,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    expect(screen.getByTestId("new-habit-message")).toBeTruthy();
    expect(screen.getByText(/Just getting started/)).toBeTruthy();
  });

  // --- Regression: weekly frequency insights use expected-frequency math ---

  it("weekly habit month comparison uses rate, not raw count", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      frequency: "weekly",
    });
    const weeklyDates = [
      "2026-02-03", "2026-02-10", "2026-02-17", "2026-02-24",
      "2026-03-03", "2026-03-07", "2026-03-10",
      "2026-01-06", "2026-01-13", "2026-01-20", "2026-01-27",
    ];
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: weeklyDates.sort().map(d => ({ date: d, completionKind: "full" as const })),
      totalCompletions: 11,
      completionsInWindow: 11,
      consistency: 80,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    expect(screen.getByTestId("insights-list")).toBeTruthy();
    expect(screen.getByTestId("insight-month-comparison")).toBeTruthy();
    const allText = JSON.stringify(screen.toJSON());
    expect(allText).not.toMatch(/worse/i);
    expect(allText).not.toMatch(/behind/i);
    expect(allText).not.toMatch(/failed/i);
  });

  it("weekly habit with 4/4 weeks completed shows matching pace", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      frequency: "weekly",
    });
    const dates = [
      "2026-03-03", "2026-03-07", "2026-03-10", "2026-03-12",
      "2026-02-03", "2026-02-10", "2026-02-17", "2026-02-24",
      "2026-01-06", "2026-01-13",
    ];
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: dates.sort().map(d => ({ date: d, completionKind: "full" as const })),
      totalCompletions: 10,
      completionsInWindow: 10,
      consistency: 90,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    expect(screen.getByTestId("insight-month-comparison")).toBeTruthy();
    expect(screen.getByText(/matching last month/)).toBeTruthy();
  });

  it("weekly habit doing worse this month shows encouraging message, not 'doing better'", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      frequency: "weekly",
      createdAt: "2026-01-01T00:00:00Z",
    });
    // 3 completions this month (March), 4 last month (Feb) — rate dropped
    const dates = [
      "2026-03-03",
      "2026-03-10",
      "2026-03-17",
      "2026-02-03",
      "2026-02-10",
      "2026-02-17",
      "2026-02-24",
      "2026-01-06",
      "2026-01-13",
    ];
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: dates.sort().map(d => ({ date: d, completionKind: "full" as const })),
      totalCompletions: 9,
      completionsInWindow: 9,
      consistency: 75,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    const allText = JSON.stringify(screen.toJSON());
    // Must NOT say "doing better" (that would be wrong — rate dropped)
    expect(allText).not.toMatch(/doing better/i);
    // Should show encouraging message
    expect(allText).toMatch(/Keep it up/i);
  });

  // --- Regression: custom-frequency insights ---

  it("custom-frequency habit (Mon/Wed/Fri) uses correct expected count", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      frequency: "custom",
      customDays: [1, 3, 5],
    });
    const customDates = [
      "2026-03-03", "2026-03-05", "2026-03-07", "2026-03-10", "2026-03-12",
      "2026-02-03", "2026-02-05", "2026-02-07", "2026-02-10",
      "2026-02-12", "2026-02-14", "2026-02-17", "2026-02-19",
      "2026-01-06", "2026-01-08", "2026-01-10",
    ];
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: customDates.sort().map(d => ({ date: d, completionKind: "full" as const })),
      totalCompletions: 16,
      completionsInWindow: 16,
      consistency: 70,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    expect(screen.getByTestId("insights-list")).toBeTruthy();
    expect(screen.getByText("Custom")).toBeTruthy();
  });

  // --- Regression: sparse habit gets encouraging message ---

  it("sparse habit (old but few completions) shows encouraging sparse message", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      createdAt: "2026-01-11T00:00:00Z",
    });
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: fullDates("2026-02-15", "2026-03-01"),
      totalCompletions: 2,
      completionsInWindow: 2,
      consistency: 3,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    expect(screen.queryByTestId("new-habit-message")).toBeNull();
    expect(screen.getByTestId("sparse-habit-message")).toBeTruthy();
    expect(screen.getByText(/Building up data/)).toBeTruthy();
    expect(screen.queryByTestId("insight-month-comparison")).toBeNull();
  });

  it("sparse habit message is encouraging, never punitive", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      createdAt: "2026-01-01T00:00:00Z",
    });
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: fullDates("2026-03-12"),
      totalCompletions: 1,
      completionsInWindow: 1,
      consistency: 2,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("sparse-habit-message")).toBeTruthy();
    });

    const allText = JSON.stringify(screen.toJSON());
    expect(allText).not.toMatch(/failed/i);
    expect(allText).not.toMatch(/you haven't/i);
    expect(allText).not.toMatch(/missed/i);
    expect(allText).not.toMatch(/behind/i);
    expect(allText).not.toMatch(/needs improvement/i);
  });

  // --- Regression: weekly habit with 2 completions in 2 weeks is NOT sparse ---

  it("weekly habit with 2 completions over 2 weeks is not sparse (100% rate)", async () => {
    // Weekly expects 1/week. 2 completions in 14 days = meeting expectations.
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      frequency: "weekly",
      createdAt: "2026-02-26T00:00:00Z",
    });
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: fullDates("2026-03-03", "2026-03-10"),
      totalCompletions: 2,
      completionsInWindow: 2,
      consistency: 100,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("insights-card")).toBeTruthy();
    });

    // Should show full insights, NOT sparse message
    expect(screen.queryByTestId("sparse-habit-message")).toBeNull();
    expect(screen.getByTestId("insights-list")).toBeTruthy();
  });

  // --- Regression: custom habit with empty customDays doesn't crash ---

  it("custom habit with null customDays gracefully shows insights", async () => {
    mockFetchHabit.mockResolvedValue({
      ...mockHabit,
      frequency: "custom",
      customDays: null,
    });
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: completedDates30,
      totalCompletions: 30,
      completionsInWindow: 30,
      consistency: 50,
    });
    renderStats();
    await waitFor(() => {
      expect(screen.getByTestId("stats-screen")).toBeTruthy();
    });

    // Should render without crashing — no month comparison (expected=0 → null)
    expect(screen.getByTestId("insights-card")).toBeTruthy();
    expect(screen.queryByTestId("insight-month-comparison")).toBeNull();
  });
});
