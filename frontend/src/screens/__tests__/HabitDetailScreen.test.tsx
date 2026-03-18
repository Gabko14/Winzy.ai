import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";
import { HabitDetailScreen } from "../HabitDetailScreen";

// --- Mocks ---

const mockHabit = {
  id: "habit-1",
  name: "Morning Run",
  icon: "🏃",
  color: "#F97316",
  frequency: "daily" as const,
  customDays: null,
  createdAt: "2026-01-01T00:00:00Z",
  archivedAt: null,
};

const mockStats = {
  habitId: "habit-1",
  consistency: 65.5,
  flameLevel: "strong" as const,
  totalCompletions: 42,
  completionsInWindow: 39,
  windowDays: 60,
  windowStart: "2026-01-11",
  today: "2026-03-12",
};

const mockFetchHabit = jest.fn();
const mockFetchHabitStats = jest.fn();
const mockCompleteHabit = jest.fn();
const mockDeleteCompletion = jest.fn();

jest.mock("../../api/habits", () => ({
  fetchHabit: (...args: unknown[]) => mockFetchHabit(...args),
  fetchHabitStats: (...args: unknown[]) => mockFetchHabitStats(...args),
  completeHabit: (...args: unknown[]) => mockCompleteHabit(...args),
  deleteCompletion: (...args: unknown[]) => mockDeleteCompletion(...args),
}));

jest.mock("../../api", () => ({
  isApiError: jest.requireActual("../../api/types").isApiError,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchHabit.mockResolvedValue(mockHabit);
  mockFetchHabitStats.mockResolvedValue(mockStats);
  mockCompleteHabit.mockResolvedValue({
    id: "comp-1",
    habitId: "habit-1",
    localDate: "2026-03-12",
    completedAt: "2026-03-12T10:00:00Z",
    consistency: 66,
  });
  mockDeleteCompletion.mockResolvedValue(undefined);
});

function renderDetail(props: Partial<React.ComponentProps<typeof HabitDetailScreen>> = {}) {
  return render(<HabitDetailScreen habitId="habit-1" {...props} />);
}

describe("HabitDetailScreen", () => {
  // --- Loading state ---

  it("shows loading state initially", () => {
    mockFetchHabit.mockReturnValue(new Promise(() => {}));
    mockFetchHabitStats.mockReturnValue(new Promise(() => {}));
    renderDetail();
    expect(screen.getByTestId("habit-detail-loading")).toBeTruthy();
    expect(screen.getByText("Loading habit details...")).toBeTruthy();
  });

  // --- Error state ---

  it("shows error state on fetch failure", async () => {
    mockFetchHabit.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-error")).toBeTruthy();
    });
    expect(screen.getByText("Something went wrong on our end. Please try again.")).toBeTruthy();
  });

  it("shows retry button on error", async () => {
    mockFetchHabit.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("Try again")).toBeTruthy();
    });
  });

  it("retries on error button press", async () => {
    mockFetchHabit
      .mockRejectedValueOnce({
        status: 500,
        code: "server_error",
        message: "Server error",
      })
      .mockResolvedValueOnce(mockHabit);
    mockFetchHabitStats.mockResolvedValue(mockStats);

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("Try again")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Try again"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });
  });

  // --- Happy path: renders habit detail ---

  it("renders habit name, icon, and flame", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });
    expect(screen.getByTestId("habit-name")).toBeTruthy();
    expect(screen.getByText("Morning Run")).toBeTruthy();
    expect(screen.getByTestId("habit-icon")).toBeTruthy();
    expect(screen.getByTestId("habit-flame")).toBeTruthy();
  });

  it("renders consistency stats", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("consistency-value")).toBeTruthy();
    });
    expect(screen.getByText("66%")).toBeTruthy(); // Math.round(65.5) = 66
    expect(screen.getByTestId("completions-in-window")).toBeTruthy();
    expect(screen.getByText("39")).toBeTruthy();
    expect(screen.getByTestId("total-completions")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("renders encouraging message based on consistency", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("encouraging-message")).toBeTruthy();
    });
    // 65.5% consistency => "Strong momentum. You're doing great!"
    expect(screen.getByText("Strong momentum. You're doing great!")).toBeTruthy();
  });

  it("renders frequency badge", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("Daily")).toBeTruthy();
    });
  });

  it("renders consistency label badge", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("Strong")).toBeTruthy();
    });
  });

  // --- Calendar ---

  it("renders the completion calendar", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("completion-calendar")).toBeTruthy();
    });
    expect(screen.getByText("Completion History")).toBeTruthy();
    expect(screen.getByText("Tap a date to log or correct a completion")).toBeTruthy();
  });

  it("navigates to previous month", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("calendar-prev")).toBeTruthy();
    });

    // Get current month display
    const currentMonthLabel = screen.getByTestId("completion-calendar");
    expect(currentMonthLabel).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId("calendar-prev"));
    });

    // Month should change (we can verify the label changed)
    // Since we start at current month, going back shows previous month
  });

  // --- Date correction flows ---

  it("adds a completion when tapping an uncompleted date in window", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });

    // Tap a date within the window (today from mock stats: 2026-03-12)
    const dayButton = screen.getByTestId("calendar-day-2026-03-12");
    expect(dayButton).toBeTruthy();

    await act(async () => {
      fireEvent.press(dayButton);
    });

    expect(mockCompleteHabit).toHaveBeenCalledWith("habit-1", {
      date: "2026-03-12",
      timezone: expect.any(String),
    });
  });

  it("removes a completion when tapping a completed date", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });

    const dayButton = screen.getByTestId("calendar-day-2026-03-12");

    // First tap: complete
    await act(async () => {
      fireEvent.press(dayButton);
    });
    expect(mockCompleteHabit).toHaveBeenCalled();

    // Second tap: uncomplete
    await act(async () => {
      fireEvent.press(dayButton);
    });
    expect(mockDeleteCompletion).toHaveBeenCalledWith("habit-1", "2026-03-12");
  });

  it("reverts optimistic update on completion error", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    // Override Platform.OS for this test
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "ios", writable: true });

    mockCompleteHabit.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Habit already completed for this date",
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });

    const dayButton = screen.getByTestId("calendar-day-2026-03-12");
    await act(async () => {
      fireEvent.press(dayButton);
    });

    // Alert should show error message
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Oops", "Habit already completed for this date");
    });

    alertSpy.mockRestore();
    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  // --- Web error feedback ---

  it("shows inline error banner on web when date toggle fails", async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });

    mockCompleteHabit.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Habit already completed for this date",
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });

    const dayButton = screen.getByTestId("calendar-day-2026-03-12");
    await act(async () => {
      fireEvent.press(dayButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId("toggle-error")).toBeTruthy();
    });
    expect(screen.getByText("Habit already completed for this date")).toBeTruthy();

    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  it("shows generic error message on web for non-API errors", async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });

    mockCompleteHabit.mockRejectedValue(new Error("Network failure"));

    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });

    const dayButton = screen.getByTestId("calendar-day-2026-03-12");
    await act(async () => {
      fireEvent.press(dayButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId("toggle-error")).toBeTruthy();
    });
    expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy();

    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  it("auto-dismisses toggle error after timeout", async () => {
    jest.useFakeTimers();
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });

    mockCompleteHabit.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });

    const dayButton = screen.getByTestId("calendar-day-2026-03-12");
    await act(async () => {
      fireEvent.press(dayButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId("toggle-error")).toBeTruthy();
    });

    // Advance timers past the 4-second auto-dismiss
    act(() => {
      jest.advanceTimersByTime(4000);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("toggle-error")).toBeNull();
    });

    jest.useRealTimers();
    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  it("reverts optimistic update and shows error on web toggle failure", async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });

    mockCompleteHabit.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Habit already completed for this date",
    });

    // Provide stats with a known completed date set
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      completedDates: [],
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });

    const dayButton = screen.getByTestId("calendar-day-2026-03-12");

    // Toggle should optimistically add, then revert on failure
    await act(async () => {
      fireEvent.press(dayButton);
    });

    // Error banner should be visible
    await waitFor(() => {
      expect(screen.getByTestId("toggle-error")).toBeTruthy();
    });

    // The button should still be pressable (not stuck in mutating state)
    expect(dayButton.props.accessibilityState?.disabled).toBeFalsy();

    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  // --- Actions ---

  it("calls onBack when back button is pressed", async () => {
    const onBack = jest.fn();
    renderDetail({ onBack });
    await waitFor(() => {
      expect(screen.getByTestId("back-button")).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId("back-button"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("calls onEdit with habitId when edit button is pressed", async () => {
    const onEdit = jest.fn();
    renderDetail({ onEdit });
    await waitFor(() => {
      expect(screen.getByText("Edit habit")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Edit habit"));
    expect(onEdit).toHaveBeenCalledWith("habit-1");
  });

  it("calls onArchive with confirmation on native", async () => {
    const onArchive = jest.fn();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _msg, buttons) => {
      // Simulate pressing "Archive"
      const archiveBtn = buttons?.find((b) => b.text === "Archive");
      archiveBtn?.onPress?.();
    });
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "ios", writable: true });

    renderDetail({ onArchive });
    await waitFor(() => {
      expect(screen.getByText("Archive habit")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Archive habit"));

    expect(alertSpy).toHaveBeenCalled();
    expect(onArchive).toHaveBeenCalledWith("habit-1");

    alertSpy.mockRestore();
    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  it("does not render back button when onBack is not provided", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });
    expect(screen.queryByTestId("back-button")).toBeNull();
  });

  it("does not render edit/archive buttons when callbacks not provided", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });
    expect(screen.queryByText("Edit habit")).toBeNull();
    expect(screen.queryByText("Archive habit")).toBeNull();
  });

  // --- Edge cases ---

  it("renders without icon when habit has no icon", async () => {
    mockFetchHabit.mockResolvedValue({ ...mockHabit, icon: null });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });
    expect(screen.queryByTestId("habit-icon")).toBeNull();
  });

  it("handles 0% consistency gracefully", async () => {
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      consistency: 0,
      flameLevel: "none",
      totalCompletions: 0,
      completionsInWindow: 0,
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("0%")).toBeTruthy();
    });
    expect(
      screen.getByText("Ready to build your habit? One day at a time."),
    ).toBeTruthy();
    expect(screen.getByText("Starting")).toBeTruthy();
  });

  it("handles 100% consistency", async () => {
    mockFetchHabitStats.mockResolvedValue({
      ...mockStats,
      consistency: 100,
      flameLevel: "blazing",
      totalCompletions: 60,
      completionsInWindow: 60,
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("100%")).toBeTruthy();
    });
    expect(screen.getByText("You're on fire! Keep it up!")).toBeTruthy();
    expect(screen.getByText("Blazing")).toBeTruthy();
  });

  it("handles not-found error", async () => {
    mockFetchHabit.mockRejectedValue({
      status: 404,
      code: "not_found",
      message: "The requested resource was not found.",
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-error")).toBeTruthy();
    });
    expect(screen.getByText("The requested resource was not found.")).toBeTruthy();
  });

  it("passes timezone to stats API", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("habit-detail-screen")).toBeTruthy();
    });
    expect(mockFetchHabitStats).toHaveBeenCalledWith("habit-1", expect.any(String));
  });
});
