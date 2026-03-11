import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { CreateHabitScreen } from "../CreateHabitScreen";

jest.mock("../../api/habits", () => ({
  fetchHabits: jest.fn().mockResolvedValue([]),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  archiveHabit: jest.fn(),
}));

jest.mock("../../api", () => ({
  isApiError: jest.requireActual("../../api/types").isApiError,
}));

const { createHabit, updateHabit } = jest.requireMock("../../api/habits");

const onClose = jest.fn();
const onSaved = jest.fn();

function renderCreate(editHabit?: Parameters<typeof CreateHabitScreen>[0]["editHabit"]) {
  return render(
    <CreateHabitScreen
      visible={true}
      onClose={onClose}
      onSaved={onSaved}
      editHabit={editHabit}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CreateHabitScreen", () => {
  // --- Happy path ---

  it("renders the create form with correct title", () => {
    renderCreate();
    expect(screen.getByText("New Habit")).toBeTruthy();
    expect(screen.getByText("Create habit")).toBeTruthy();
    expect(screen.getByLabelText("Habit name")).toBeTruthy();
  });

  it("renders as edit form when editHabit is provided", () => {
    renderCreate({
      id: "h1",
      name: "Morning run",
      icon: "\uD83C\uDFC3",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    });
    expect(screen.getByText("Edit Habit")).toBeTruthy();
    expect(screen.getByText("Save changes")).toBeTruthy();
  });

  it("creates a habit on valid submit", async () => {
    const newHabit = {
      id: "h1",
      name: "Morning run",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Morning run");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(createHabit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Morning run",
          frequency: "daily",
        }),
      );
    });

    expect(onSaved).toHaveBeenCalledWith(newHabit);
    expect(onClose).toHaveBeenCalled();
  });

  it("updates a habit in edit mode", async () => {
    const existingHabit = {
      id: "h1",
      name: "Morning run",
      icon: "\uD83C\uDFC3",
      color: "#F97316",
      frequency: "daily" as const,
      customDays: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    const updatedHabit = { ...existingHabit, name: "Evening run" };
    updateHabit.mockResolvedValue(updatedHabit);

    renderCreate(existingHabit);
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Evening run");

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(updateHabit).toHaveBeenCalledWith(
        "h1",
        expect.objectContaining({ name: "Evening run" }),
      );
    });

    expect(onSaved).toHaveBeenCalledWith(updatedHabit);
  });

  // --- Validation ---

  it("shows validation error for empty name on submit", async () => {
    renderCreate();

    // Clear the default name (empty by default)
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    expect(screen.getByText("Habit name is required.")).toBeTruthy();
    expect(createHabit).not.toHaveBeenCalled();
  });

  it("clears name error when user types", async () => {
    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    expect(screen.getByText("Habit name is required.")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("habit-name-input"), "a");
    expect(screen.queryByText("Habit name is required.")).toBeNull();
  });

  it("shows error when custom frequency has no days selected", async () => {
    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test habit");
    fireEvent.press(screen.getByTestId("freq-custom"));

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    expect(screen.getByText("Select at least one day for custom frequency.")).toBeTruthy();
    expect(createHabit).not.toHaveBeenCalled();
  });

  // --- Icon/Color/Frequency pickers ---

  it("renders icon picker with selectable options", () => {
    renderCreate();
    expect(screen.getByTestId("icon-picker")).toBeTruthy();
  });

  it("renders color picker with selectable options", () => {
    renderCreate();
    expect(screen.getByTestId("color-picker")).toBeTruthy();
  });

  it("renders frequency picker with all options", () => {
    renderCreate();
    expect(screen.getByTestId("freq-daily")).toBeTruthy();
    expect(screen.getByTestId("freq-weekly")).toBeTruthy();
    expect(screen.getByTestId("freq-custom")).toBeTruthy();
  });

  it("shows day picker when custom frequency is selected", () => {
    renderCreate();
    // Days picker should not be visible initially (daily frequency)
    expect(screen.queryByTestId("days-picker")).toBeNull();

    // Select custom frequency
    fireEvent.press(screen.getByTestId("freq-custom"));
    expect(screen.getByTestId("days-picker")).toBeTruthy();
  });

  it("toggles custom day selection", () => {
    renderCreate();
    fireEvent.press(screen.getByTestId("freq-custom"));

    const monButton = screen.getByTestId("day-Mon");
    fireEvent.press(monButton);
    expect(monButton.props.accessibilityState.checked).toBe(true);

    fireEvent.press(monButton);
    expect(monButton.props.accessibilityState.checked).toBe(false);
  });

  // --- Error handling ---

  it("shows server error for network failure", async () => {
    createHabit.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Unable to reach the server.",
    });

    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test habit");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(
        screen.getByText("Unable to reach the server. Please check your connection."),
      ).toBeTruthy();
    });
  });

  it("shows generic server error for unknown failures", async () => {
    createHabit.mockRejectedValue(new Error("unexpected"));

    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test habit");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy();
    });
  });

  it("clears server error when user types in name", async () => {
    createHabit.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    });

    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("server-error")).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test2");
    expect(screen.queryByTestId("server-error")).toBeNull();
  });

  // --- Edge cases ---

  it("trims habit name before submitting", async () => {
    const newHabit = {
      id: "h1",
      name: "Morning run",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "  Morning run  ");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(createHabit).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Morning run" }),
      );
    });
  });

  it("does not include customDays when frequency is not custom", async () => {
    const newHabit = {
      id: "h1",
      name: "Test",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      const call = createHabit.mock.calls[0][0];
      expect(call.customDays).toBeUndefined();
    });
  });
});
