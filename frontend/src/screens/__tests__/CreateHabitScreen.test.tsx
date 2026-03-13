import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { CreateHabitScreen } from "../CreateHabitScreen";

jest.mock("../../api/habits", () => ({
  fetchHabits: jest.fn().mockResolvedValue([]),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  archiveHabit: jest.fn(),
}));

jest.mock("../../api/visibility", () => ({
  fetchPreferences: jest.fn().mockResolvedValue({ defaultHabitVisibility: "private" }),
  updateVisibility: jest.fn().mockResolvedValue({ habitId: "h1", visibility: "private" }),
  fetchVisibility: jest.fn().mockResolvedValue({ defaultVisibility: "private", habits: [] }),
}));

jest.mock("../../api", () => ({
  isApiError: jest.requireActual("../../api/types").isApiError,
}));

const { createHabit, updateHabit } = jest.requireMock("../../api/habits");
const { fetchPreferences, updateVisibility } = jest.requireMock("../../api/visibility");

const onClose = jest.fn();
const onSaved = jest.fn();

function renderCreate(props?: Partial<Parameters<typeof CreateHabitScreen>[0]>) {
  return render(
    <CreateHabitScreen
      visible={true}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset default mocks
  fetchPreferences.mockResolvedValue({ defaultHabitVisibility: "private" });
  updateVisibility.mockResolvedValue({ habitId: "h1", visibility: "private" });
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
      editHabit: {
        id: "h1",
        name: "Morning run",
        icon: "\uD83C\uDFC3",
        color: "#F97316",
        frequency: "daily",
        customDays: null,
        createdAt: "2026-01-01T00:00:00Z",
        archivedAt: null,
      },
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

    renderCreate({ editHabit: existingHabit });
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

  // --- Visibility picker ---

  it("shows visibility picker with private/friends/public options", () => {
    renderCreate();
    expect(screen.getByTestId("visibility-picker")).toBeTruthy();
    expect(screen.getByTestId("visibility-private")).toBeTruthy();
    expect(screen.getByTestId("visibility-friends")).toBeTruthy();
    expect(screen.getByTestId("visibility-public")).toBeTruthy();
  });

  it("defaults visibility from Social Service user preferences", async () => {
    fetchPreferences.mockResolvedValue({ defaultHabitVisibility: "friends" });

    renderCreate();

    // Wait for the preference to load and apply via resetForm
    await waitFor(() => {
      const friendsBtn = screen.getByTestId("visibility-friends");
      expect(friendsBtn.props.accessibilityState.selected).toBe(true);
    });
  });

  it("calls PUT /social/visibility/{habitId} on edit submit", async () => {
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
    updateHabit.mockResolvedValue(existingHabit);

    renderCreate({ editHabit: existingHabit, editVisibility: "private" });

    // Wait for preferences to load so picker is enabled
    await waitFor(() => {
      expect(screen.getByTestId("visibility-friends").props.accessibilityState.disabled).toBeFalsy();
    });

    // Change visibility to friends
    await act(async () => {
      fireEvent.press(screen.getByTestId("visibility-friends"));
    });

    // Verify the state change took effect
    await waitFor(() => {
      expect(screen.getByTestId("visibility-friends").props.accessibilityState.selected).toBe(true);
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(updateVisibility).toHaveBeenCalledWith("h1", "friends");
    });
  });

  it("saves visibility after creating a new habit", async () => {
    const newHabit = {
      id: "new-h1",
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

    // Wait for preferences to load so picker is enabled
    await waitFor(() => {
      expect(screen.getByTestId("visibility-public").props.accessibilityState.disabled).toBeFalsy();
    });

    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");

    // Set visibility to public
    await act(async () => {
      fireEvent.press(screen.getByTestId("visibility-public"));
    });

    // Verify the state change took effect
    await waitFor(() => {
      expect(screen.getByTestId("visibility-public").props.accessibilityState.selected).toBe(true);
    });

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(updateVisibility).toHaveBeenCalledWith("new-h1", "public");
    });
  });

  it("shows correct visibility icon/text on each option", () => {
    renderCreate();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Friends")).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Only you")).toBeTruthy();
    expect(screen.getByText("Approved friends")).toBeTruthy();
    expect(screen.getByText("Anyone with link")).toBeTruthy();
  });

  // --- Edge case: Social Service down ---

  it("creates habit as private when Social Service is down during create", async () => {
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
    updateVisibility.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Network error",
    });

    renderCreate();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");
    fireEvent.press(screen.getByTestId("visibility-friends"));

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    // Habit should still be created
    await waitFor(() => {
      expect(createHabit).toHaveBeenCalled();
    });

    // Modal stays open with error — user is informed
    await waitFor(() => {
      expect(screen.getByTestId("server-error")).toBeTruthy();
      expect(
        screen.getByText("Habit created! Visibility defaulted to private — you can change it anytime."),
      ).toBeTruthy();
    });

    // onSaved is NOT called — modal stays open so user can see the error
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows visibility change failed error on PUT 404", async () => {
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
    updateHabit.mockResolvedValue(existingHabit);
    updateVisibility.mockRejectedValue({
      status: 404,
      code: "not_found",
      message: "Not found",
    });

    renderCreate({ editHabit: existingHabit, editVisibility: "private" });
    fireEvent.press(screen.getByTestId("visibility-public"));

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    // Modal stays open with error message — visibility failure blocks close
    await waitFor(() => {
      expect(screen.getByTestId("server-error")).toBeTruthy();
      expect(
        screen.getByText("Habit saved, but visibility could not be updated. Please try again."),
      ).toBeTruthy();
    });

    // onSaved is NOT called — user needs to retry or close manually
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("habit with no visibility row defaults to private correctly", () => {
    // When editVisibility is not provided, should default to private
    renderCreate();
    const privateBtn = screen.getByTestId("visibility-private");
    expect(privateBtn.props.accessibilityState.selected).toBe(true);
  });

  // --- Validation ---

  it("shows validation error for empty name on submit", async () => {
    renderCreate();

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
    expect(screen.queryByTestId("days-picker")).toBeNull();

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
