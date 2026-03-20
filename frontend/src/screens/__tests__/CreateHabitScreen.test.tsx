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

/** Render the create screen and skip past the template picker to the form */
function renderCreateForm(props?: Partial<Parameters<typeof CreateHabitScreen>[0]>) {
  const result = renderCreate(props);
  // Skip template picker for new habits (edits go straight to form)
  if (!props?.editHabit) {
    fireEvent.press(screen.getByTestId("template-skip"));
  }
  return result;
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
    renderCreateForm();
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
        minimumDescription: null,
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
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreateForm();
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
      minimumDescription: null,
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
    renderCreateForm();
    expect(screen.getByTestId("visibility-picker")).toBeTruthy();
    expect(screen.getByTestId("visibility-private")).toBeTruthy();
    expect(screen.getByTestId("visibility-friends")).toBeTruthy();
    expect(screen.getByTestId("visibility-public")).toBeTruthy();
  });

  it("defaults visibility from Social Service user preferences", async () => {
    fetchPreferences.mockResolvedValue({ defaultHabitVisibility: "friends" });

    renderCreateForm();

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
      minimumDescription: null,
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
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreateForm();

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
    renderCreateForm();
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
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);
    updateVisibility.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Network error",
    });

    renderCreateForm();
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

    // onSaved is NOT called yet — it would close the modal via the parent.
    // It will be called when the user closes the modal (retry or dismiss).
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows visibility change failed error on PUT 404", async () => {
    const existingHabit = {
      id: "h1",
      name: "Morning run",
      icon: "\uD83C\uDFC3",
      color: "#F97316",
      frequency: "daily" as const,
      customDays: null,
      minimumDescription: null,
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

    // onSaved is NOT called yet — it would close the modal via the parent
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("habit with no visibility row defaults to private correctly", () => {
    // When editVisibility is not provided, should default to private
    renderCreateForm();
    const privateBtn = screen.getByTestId("visibility-private");
    expect(privateBtn.props.accessibilityState.selected).toBe(true);
  });

  // --- Validation ---

  it("shows validation error for empty name on submit", async () => {
    renderCreateForm();

    fireEvent.changeText(screen.getByTestId("habit-name-input"), "");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    expect(screen.getByText("Habit name is required.")).toBeTruthy();
    expect(createHabit).not.toHaveBeenCalled();
  });

  it("clears name error when user types", async () => {
    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    expect(screen.getByText("Habit name is required.")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("habit-name-input"), "a");
    expect(screen.queryByText("Habit name is required.")).toBeNull();
  });

  it("shows error when custom frequency has no days selected", async () => {
    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test habit");
    fireEvent.press(screen.getByTestId("freq-custom"));

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    expect(screen.getByText("Select at least one day.")).toBeTruthy();
    expect(createHabit).not.toHaveBeenCalled();
  });

  it("shows error when weekly frequency has no days selected", async () => {
    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test habit");
    fireEvent.press(screen.getByTestId("freq-weekly"));

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    expect(screen.getByText("Select at least one day.")).toBeTruthy();
    expect(createHabit).not.toHaveBeenCalled();
  });

  // --- Icon/Color/Frequency pickers ---

  it("renders icon picker with selectable options", () => {
    renderCreateForm();
    expect(screen.getByTestId("icon-picker")).toBeTruthy();
  });

  it("renders color picker with selectable options", () => {
    renderCreateForm();
    expect(screen.getByTestId("color-picker")).toBeTruthy();
  });

  it("renders frequency picker with all options", () => {
    renderCreateForm();
    expect(screen.getByTestId("freq-daily")).toBeTruthy();
    expect(screen.getByTestId("freq-weekly")).toBeTruthy();
    expect(screen.getByTestId("freq-custom")).toBeTruthy();
  });

  it("shows day picker when custom frequency is selected", () => {
    renderCreateForm();
    expect(screen.queryByTestId("days-picker")).toBeNull();

    fireEvent.press(screen.getByTestId("freq-custom"));
    expect(screen.getByTestId("days-picker")).toBeTruthy();
  });

  it("shows day picker when weekly frequency is selected", () => {
    renderCreateForm();
    expect(screen.queryByTestId("days-picker")).toBeNull();

    fireEvent.press(screen.getByTestId("freq-weekly"));
    expect(screen.getByTestId("days-picker")).toBeTruthy();
  });

  it("sends customDays when weekly frequency is submitted with days selected", async () => {
    const newHabit = {
      id: "h1",
      name: "Gym",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "weekly",
      customDays: [1, 3, 5],
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Gym");
    fireEvent.press(screen.getByTestId("freq-weekly"));

    // Select Mon, Wed, Fri
    fireEvent.press(screen.getByTestId("day-Mon"));
    fireEvent.press(screen.getByTestId("day-Wed"));
    fireEvent.press(screen.getByTestId("day-Fri"));

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(createHabit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Gym",
          frequency: "weekly",
          customDays: [1, 3, 5],
        }),
      );
    });
  });

  it("toggles custom day selection", () => {
    renderCreateForm();
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

    renderCreateForm();
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

    renderCreateForm();
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

    renderCreateForm();
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
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreateForm();
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

  it("does not include customDays when frequency is daily", async () => {
    const newHabit = {
      id: "h1",
      name: "Test",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      const call = createHabit.mock.calls[0][0];
      expect(call.customDays).toBeUndefined();
    });
  });

  // --- Template picker integration ---

  it("shows template picker when creating a new habit", () => {
    renderCreate();
    expect(screen.getByTestId("template-picker")).toBeTruthy();
    // Form should be hidden while template picker is showing
    expect(screen.queryByTestId("habit-name-input")).toBeNull();
  });

  it("does not show template picker when editing a habit", () => {
    renderCreate({
      editHabit: {
        id: "h1",
        name: "Morning run",
        icon: "\uD83C\uDFC3",
        color: "#F97316",
        frequency: "daily",
        customDays: null,
        minimumDescription: null,
        createdAt: "2026-01-01T00:00:00Z",
        archivedAt: null,
      },
    });
    expect(screen.queryByTestId("template-picker")).toBeNull();
    expect(screen.getByTestId("habit-name-input")).toBeTruthy();
  });

  it("selecting a template pre-fills the form with template data", () => {
    renderCreate();
    // Select the Meditation template (first in Health)
    fireEvent.press(screen.getByTestId("template-meditation"));

    // Template picker should be dismissed, form should be visible
    expect(screen.queryByTestId("template-picker")).toBeNull();
    expect(screen.getByTestId("habit-name-input").props.value).toBe("Meditation");
  });

  it("user can customize pre-filled fields from template before saving", async () => {
    const newHabit = {
      id: "h1",
      name: "Morning meditation",
      icon: "\uD83E\uDDD8",
      color: "#7C3AED",
      frequency: "daily",
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreate();
    // Select Meditation template
    fireEvent.press(screen.getByTestId("template-meditation"));

    // Customize the name
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Morning meditation");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(createHabit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Morning meditation",
          icon: "\uD83E\uDDD8",
          color: "#7C3AED",
          frequency: "daily",
        }),
      );
    });
  });

  it("skipping templates shows the empty create form", () => {
    renderCreate();
    expect(screen.getByTestId("template-picker")).toBeTruthy();

    fireEvent.press(screen.getByTestId("template-skip"));

    expect(screen.queryByTestId("template-picker")).toBeNull();
    expect(screen.getByTestId("habit-name-input")).toBeTruthy();
    // Name should be empty (no template selected)
    expect(screen.getByTestId("habit-name-input").props.value).toBe("");
  });

  it("template picker resets when modal is re-opened", () => {
    const { rerender } = renderCreate();
    // Skip templates
    fireEvent.press(screen.getByTestId("template-skip"));
    expect(screen.queryByTestId("template-picker")).toBeNull();

    // Close and re-open modal
    rerender(
      <CreateHabitScreen
        visible={false}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    rerender(
      <CreateHabitScreen
        visible={true}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    // Template picker should be back
    expect(screen.getByTestId("template-picker")).toBeTruthy();
  });

  // --- Visibility race condition ---

  it("preserves form state when default visibility loads late", async () => {
    // Simulate slow default visibility fetch
    let resolvePrefs!: (v: { defaultHabitVisibility: string }) => void;
    fetchPreferences.mockReturnValue(
      new Promise((resolve) => {
        resolvePrefs = resolve;
      }),
    );

    renderCreateForm();

    // User types a habit name while default visibility is still loading
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "My custom habit");

    // Now the default visibility resolves as "friends"
    await act(async () => {
      resolvePrefs({ defaultHabitVisibility: "friends" });
    });

    // User's name input should be preserved — NOT wiped by the late default
    expect(screen.getByTestId("habit-name-input").props.value).toBe("My custom habit");
    // And the default visibility should be applied since user didn't touch the picker
    await waitFor(() => {
      expect(screen.getByTestId("visibility-friends").props.accessibilityState.selected).toBe(true);
    });
  });

  it("preserves user visibility choice when default loads late", async () => {
    // Default loads as "friends" first
    fetchPreferences.mockResolvedValue({ defaultHabitVisibility: "friends" });

    renderCreateForm();

    // Wait for default to load
    await waitFor(() => {
      expect(screen.getByTestId("visibility-friends").props.accessibilityState.selected).toBe(true);
    });

    // User manually picks "public"
    fireEvent.press(screen.getByTestId("visibility-public"));
    expect(screen.getByTestId("visibility-public").props.accessibilityState.selected).toBe(true);

    // Simulate a rerender that could trigger effects — user's choice must persist
    expect(screen.getByTestId("visibility-public").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("visibility-friends").props.accessibilityState.selected).toBe(false);
  });

  it("applies default visibility when user has not interacted", async () => {
    let resolvePrefs!: (v: { defaultHabitVisibility: string }) => void;
    fetchPreferences.mockReturnValue(
      new Promise((resolve) => {
        resolvePrefs = resolve;
      }),
    );

    renderCreateForm();

    // Initially private (before default loads)
    expect(screen.getByTestId("visibility-private").props.accessibilityState.selected).toBe(true);

    // Default loads as "friends" — user hasn't touched the picker
    await act(async () => {
      resolvePrefs({ defaultHabitVisibility: "friends" });
    });

    // Should apply the default since user hasn't interacted
    await waitFor(() => {
      expect(screen.getByTestId("visibility-friends").props.accessibilityState.selected).toBe(true);
    });
  });

  // --- Partial-success recovery ---

  it("shows retry button after habit create succeeds but visibility fails", async () => {
    const newHabit = {
      id: "h1",
      name: "Test",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);
    updateVisibility.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Network error",
    });

    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    // After visibility failure, button should say "Retry visibility"
    await waitFor(() => {
      expect(screen.getByText("Retry visibility")).toBeTruthy();
    });
  });

  it("retries only visibility POST on partial-success retry (no duplicate habit)", async () => {
    const newHabit = {
      id: "h1",
      name: "Test",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);
    updateVisibility
      .mockRejectedValueOnce({ status: 0, code: "network", message: "Network error" })
      .mockResolvedValueOnce({ habitId: "h1", visibility: "private" });

    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");

    // First submit — habit created, visibility fails
    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(screen.getByText("Retry visibility")).toBeTruthy();
    });

    // Retry — should NOT call createHabit again
    createHabit.mockClear();

    await act(async () => {
      fireEvent.press(screen.getByText("Retry visibility"));
    });

    // createHabit should NOT have been called again
    expect(createHabit).not.toHaveBeenCalled();
    // updateVisibility should have been retried
    expect(updateVisibility).toHaveBeenCalledTimes(2);
    // Modal should close on success
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("closing modal after partial failure flushes onSaved for the created habit", async () => {
    const newHabit = {
      id: "h1",
      name: "Test",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);
    updateVisibility.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Network error",
    });

    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Test");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(screen.getByText("Retry visibility")).toBeTruthy();
    });

    // onSaved not called yet
    expect(onSaved).not.toHaveBeenCalled();

    // User dismisses the modal via the close button
    fireEvent.press(screen.getByLabelText("Close"));

    // onSaved should now be called with the saved habit so it appears in the list
    expect(onSaved).toHaveBeenCalledWith(newHabit);
    expect(onClose).toHaveBeenCalled();
  });

  it("handles partial success on edit: habit saved, visibility retry works", async () => {
    const existingHabit = {
      id: "h1",
      name: "Morning run",
      icon: "\uD83C\uDFC3",
      color: "#F97316",
      frequency: "daily" as const,
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    updateHabit.mockResolvedValue(existingHabit);
    updateVisibility
      .mockRejectedValueOnce({ status: 500, code: "server_error", message: "Error" })
      .mockResolvedValueOnce({ habitId: "h1", visibility: "public" });

    renderCreate({ editHabit: existingHabit, editVisibility: "private" });
    fireEvent.press(screen.getByTestId("visibility-public"));

    // First submit — habit saved, visibility fails
    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Retry visibility")).toBeTruthy();
      expect(screen.getByText("Habit saved, but visibility could not be updated. Please try again.")).toBeTruthy();
    });

    // onSaved NOT called yet — deferred until modal closes
    expect(onSaved).not.toHaveBeenCalled();

    // Retry
    updateHabit.mockClear();

    await act(async () => {
      fireEvent.press(screen.getByText("Retry visibility"));
    });

    // updateHabit should NOT be called again
    expect(updateHabit).not.toHaveBeenCalled();
    // Success — handleSaved calls onSaved + onClose
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(existingHabit);
      expect(onClose).toHaveBeenCalled();
    });
  });

  // --- Honest Minimums ---

  it("renders honest minimum text field", () => {
    renderCreateForm();
    expect(screen.getByTestId("minimum-description-input")).toBeTruthy();
  });

  it("sends minimumDescription on create when provided", async () => {
    const newHabit = {
      id: "h1",
      name: "Workout",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      minimumDescription: "10-minute walk",
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Workout");
    fireEvent.changeText(screen.getByTestId("minimum-description-input"), "10-minute walk");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      expect(createHabit).toHaveBeenCalledWith(
        expect.objectContaining({ minimumDescription: "10-minute walk" }),
      );
    });
  });

  it("does not send minimumDescription when field is empty", async () => {
    const newHabit = {
      id: "h1",
      name: "Run",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily",
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    createHabit.mockResolvedValue(newHabit);

    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("habit-name-input"), "Run");

    await act(async () => {
      fireEvent.press(screen.getByText("Create habit"));
    });

    await waitFor(() => {
      const call = createHabit.mock.calls[0][0];
      expect(call.minimumDescription).toBeUndefined();
    });
  });

  it("populates minimumDescription from editHabit when editing", () => {
    renderCreate({
      editHabit: {
        id: "h1",
        name: "Workout",
        icon: "\uD83D\uDCAA",
        color: "#F97316",
        frequency: "daily",
        customDays: null,
        minimumDescription: "10-minute walk",
        createdAt: "2026-01-01T00:00:00Z",
        archivedAt: null,
      },
    });
    expect(screen.getByTestId("minimum-description-input").props.value).toBe("10-minute walk");
  });

  it("shows clear button when minimum description has text", () => {
    renderCreateForm();
    expect(screen.queryByTestId("minimum-clear")).toBeNull();

    fireEvent.changeText(screen.getByTestId("minimum-description-input"), "Walk");
    expect(screen.getByTestId("minimum-clear")).toBeTruthy();
  });

  it("clears minimum description when clear button is pressed", () => {
    renderCreateForm();
    fireEvent.changeText(screen.getByTestId("minimum-description-input"), "Walk");
    fireEvent.press(screen.getByTestId("minimum-clear"));
    expect(screen.getByTestId("minimum-description-input").props.value).toBe("");
  });

  it("sends clearMinimumDescription when editing and clearing minimum", async () => {
    const existingHabit = {
      id: "h1",
      name: "Workout",
      icon: "\uD83D\uDCAA",
      color: "#F97316",
      frequency: "daily" as const,
      customDays: null,
      minimumDescription: "10-minute walk",
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    };
    updateHabit.mockResolvedValue({ ...existingHabit, minimumDescription: null });

    renderCreate({ editHabit: existingHabit });

    // Clear the minimum
    fireEvent.press(screen.getByTestId("minimum-clear"));

    await act(async () => {
      fireEvent.press(screen.getByText("Save changes"));
    });

    await waitFor(() => {
      expect(updateHabit).toHaveBeenCalledWith(
        "h1",
        expect.objectContaining({ clearMinimumDescription: true }),
      );
    });
  });
});
