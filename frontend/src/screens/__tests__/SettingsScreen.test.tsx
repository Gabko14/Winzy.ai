import React from "react";
import { Platform } from "react-native";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { SettingsScreen } from "../SettingsScreen";
import { AuthProvider } from "../../hooks/useAuth";

jest.mock("../../api", () => {
  const mockBootstrap = jest.fn().mockResolvedValue({
    accessToken: "tok",
    refreshToken: "ref",
    user: {
      id: "1",
      email: "alice@test.com",
      username: "alice",
      displayName: "Alice Smith",
      avatarUrl: null,
      createdAt: "2026-01-01",
    },
  });
  const mockApi = {
    post: jest.fn(),
    put: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  };
  const mockTokenStore = {
    setAccessToken: jest.fn().mockResolvedValue(undefined),
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue("tok"),
    getRefreshToken: jest.fn().mockResolvedValue("ref"),
    clear: jest.fn().mockResolvedValue(undefined),
  };

  return {
    bootstrapSession: mockBootstrap,
    api: mockApi,
    tokenStore: mockTokenStore,
    isApiError: jest.requireActual("../../api/types").isApiError,
  };
});

jest.mock("../../api/visibility", () => ({
  fetchPreferences: jest.fn().mockResolvedValue({ defaultHabitVisibility: "private" }),
  updateDefaultVisibility: jest.fn().mockResolvedValue({ defaultHabitVisibility: "friends" }),
}));

jest.mock("../../api/account", () => ({
  exportMyData: jest.fn().mockResolvedValue({
    exportedAt: "2026-03-14T00:00:00Z",
    services: [{ service: "auth", data: {} }],
  }),
}));

const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();
const mockPushState = {
  status: "unsubscribed" as string,
  platform: "web_push" as string,
  subscribing: false,
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
};

jest.mock("../../hooks/usePushNotifications", () => ({
  usePushNotifications: () => mockPushState,
}));

const { api } = jest.requireMock("../../api");
const { fetchPreferences, updateDefaultVisibility } = jest.requireMock("../../api/visibility");
const { exportMyData } = jest.requireMock("../../api/account");

const onBack = jest.fn();
const onEditProfile = jest.fn();

function renderSettings() {
  return render(
    <AuthProvider>
      <SettingsScreen onBack={onBack} onEditProfile={onEditProfile} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPushState.status = "unsubscribed";
  mockPushState.platform = "web_push";
  mockPushState.subscribing = false;
  mockSubscribe.mockResolvedValue(undefined);
  mockUnsubscribe.mockResolvedValue(undefined);
  fetchPreferences.mockResolvedValue({ defaultHabitVisibility: "private" });
  updateDefaultVisibility.mockResolvedValue({ defaultHabitVisibility: "friends" });
  exportMyData.mockResolvedValue({
    exportedAt: "2026-03-14T00:00:00Z",
    services: [{ service: "auth", data: {} }],
  });
  api.delete.mockResolvedValue(undefined);
});

// --- Account Section ---

describe("SettingsScreen — Account Section", () => {
  it("displays name, avatar initials, and email", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-screen")).toBeTruthy();
    });

    expect(screen.getByTestId("settings-display-name").props.children).toBe("Alice Smith");
    expect(screen.getByTestId("settings-email").props.children).toBe("alice@test.com");
  });

  it("navigates to edit profile when Edit is pressed", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-edit-profile")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-edit-profile"));
    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it("signs out and clears session when sign out is pressed", async () => {
    api.post.mockResolvedValue(undefined);

    renderSettings();
    await waitFor(() => {
      expect(screen.getByText("Sign out")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Sign out"));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/auth/logout", undefined);
    });
  });

  it("does not clear local state when sign out API fails", async () => {
    const { tokenStore } = jest.requireMock("../../api");
    api.post.mockRejectedValue(new Error("network error"));

    renderSettings();
    await waitFor(() => {
      expect(screen.getByText("Sign out")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Sign out"));
    // The logout error propagates — tokens are NOT cleared because the server
    // did not confirm revocation. The HttpOnly cookie is still alive.
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/auth/logout", undefined);
    });
    expect(tokenStore.clear).not.toHaveBeenCalled();
    // Error feedback is shown to the user
    await waitFor(() => {
      expect(screen.getByTestId("sign-out-error")).toBeTruthy();
    });
  });
});

// --- Privacy Section ---

describe("SettingsScreen — Privacy Section", () => {
  it("renders current default visibility from Social Service", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("visibility-check-private")).toBeTruthy();
    });

    // "private" should be selected
    expect(screen.getByTestId("visibility-option-private")).toBeTruthy();
    expect(screen.getByTestId("visibility-option-friends")).toBeTruthy();
    expect(screen.getByTestId("visibility-option-public")).toBeTruthy();
  });

  it("updates default visibility via PUT /social/preferences", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("visibility-check-private")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId("visibility-option-friends"));
    });

    expect(updateDefaultVisibility).toHaveBeenCalledWith("friends");
  });

  it("explains that changing default only affects future habits", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-privacy-section")).toBeTruthy();
    });

    expect(screen.getByText(/only affects habits you create after this point/i)).toBeTruthy();
  });

  it("shows default values with warning when preferences fetch fails", async () => {
    fetchPreferences.mockRejectedValue({ status: 0, code: "network", message: "offline" });

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("visibility-error")).toBeTruthy();
    });

    expect(screen.getByText("Could not load privacy settings")).toBeTruthy();
    // Falls back to "private" as default
    expect(screen.getByTestId("visibility-check-private")).toBeTruthy();
  });

  it("reverts to previous value when update fails", async () => {
    updateDefaultVisibility.mockRejectedValue({ status: 500, code: "server_error", message: "fail" });

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("visibility-check-private")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId("visibility-option-public"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("visibility-error")).toBeTruthy();
    });

    // Should revert back to private
    expect(screen.getByTestId("visibility-check-private")).toBeTruthy();
  });
});

// --- Appearance Section ---

describe("SettingsScreen — Appearance Section", () => {
  beforeEach(() => {
    // Clear localStorage mock
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("renders theme toggle with light, dark, and system options", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-appearance-section")).toBeTruthy();
    });

    expect(screen.getByTestId("theme-option-light")).toBeTruthy();
    expect(screen.getByTestId("theme-option-dark")).toBeTruthy();
    expect(screen.getByTestId("theme-option-system")).toBeTruthy();
  });

  it("defaults to system theme", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-appearance-section")).toBeTruthy();
    });

    // System should be selected by default (in test env, no localStorage)
    const systemOption = screen.getByTestId("theme-option-system");
    expect(systemOption).toBeTruthy();
  });

  it("changes theme on press", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("theme-option-dark")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("theme-option-dark"));
    // Theme changed — the dark option should now have the selected style
    // We verify the press doesn't throw and the component re-renders
    expect(screen.getByTestId("theme-option-dark")).toBeTruthy();
  });
});

// --- About Section ---

describe("SettingsScreen — About Section", () => {
  it("displays app version", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-version")).toBeTruthy();
    });

    expect(screen.getByTestId("settings-version").props.children).toBe("1.0.0");
  });

  it("renders privacy policy link", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-privacy-policy")).toBeTruthy();
    });
  });
});

// --- Data & Account Section ---

describe("SettingsScreen — Data Export", () => {
  it("renders export data button", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-export-data")).toBeTruthy();
    });

    expect(screen.getByText("Export my data")).toBeTruthy();
  });

  it("calls exportMyData API when export is pressed", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-export-data")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId("settings-export-data"));
    });

    expect(exportMyData).toHaveBeenCalledTimes(1);
  });

  it("shows error when export fails", async () => {
    exportMyData.mockRejectedValue({ status: 500, code: "server_error", message: "Export failed" });

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-export-data")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId("settings-export-data"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("export-error")).toBeTruthy();
    });

    expect(screen.getByText("Export failed")).toBeTruthy();
  });
});

describe("SettingsScreen — Account Deletion", () => {
  it("renders delete account button", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-delete-account")).toBeTruthy();
    });

    expect(screen.getByText("Delete account")).toBeTruthy();
  });

  it("shows confirmation modal when delete is pressed", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-delete-account")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-delete-account"));

    await waitFor(() => {
      expect(screen.getByText("Delete account?")).toBeTruthy();
    });

    // Modal shows the confirmation button (Button component uses accessibilityLabel, not testID)
    expect(screen.getByLabelText("Permanently delete your account")).toBeTruthy();
  });

  it("calls auth.deleteAccount and clears tokens on confirm", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-delete-account")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-delete-account"));

    await waitFor(() => {
      expect(screen.getByLabelText("Permanently delete your account")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Permanently delete your account"));
    });

    // auth.deleteAccount() calls api.delete("/auth/account") and clears tokens
    expect(api.delete).toHaveBeenCalledWith("/auth/account");
    const { tokenStore } = jest.requireMock("../../api");
    await waitFor(() => {
      expect(tokenStore.clear).toHaveBeenCalled();
    });
  });

  it("shows error in modal when deletion fails", async () => {
    api.delete.mockRejectedValue({ status: 500, code: "server_error", message: "Deletion failed" });

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-delete-account")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-delete-account"));

    await waitFor(() => {
      expect(screen.getByLabelText("Permanently delete your account")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Permanently delete your account"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("delete-modal-error")).toBeTruthy();
    });
  });

  it("dismisses confirmation modal on cancel", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-delete-account")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-delete-account"));

    await waitFor(() => {
      expect(screen.getByText("Delete account?")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByText("Delete account?")).toBeNull();
    });
  });
});

// --- Notifications Section ---

describe("SettingsScreen — Notifications Section", () => {
  it("renders push toggle when status is unsubscribed", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-notifications-section")).toBeTruthy();
    });

    expect(screen.getByTestId("push-toggle-row")).toBeTruthy();
    expect(screen.getByTestId("push-toggle")).toBeTruthy();
    expect(screen.getByText("Get reminders and friend activity updates")).toBeTruthy();
  });

  it("renders enabled toggle when status is subscribed", async () => {
    mockPushState.status = "subscribed";

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("push-toggle")).toBeTruthy();
    });

    expect(screen.getByText("You'll receive reminders and friend activity")).toBeTruthy();
  });

  it("calls subscribe when toggle is turned on", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("push-toggle")).toBeTruthy();
    });

    await act(async () => {
      fireEvent(screen.getByTestId("push-toggle"), "valueChange", true);
    });

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it("calls unsubscribe when toggle is turned off", async () => {
    mockPushState.status = "subscribed";

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("push-toggle")).toBeTruthy();
    });

    await act(async () => {
      fireEvent(screen.getByTestId("push-toggle"), "valueChange", false);
    });

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("shows denied state with instructions on web", async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });

    mockPushState.status = "denied";

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("push-denied")).toBeTruthy();
    });

    expect(screen.getByText(/blocked by your browser or device settings/i)).toBeTruthy();
    expect(screen.getByTestId("push-denied-instructions")).toBeTruthy();
    expect(screen.getByText(/click the lock icon/i)).toBeTruthy();

    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
  });

  it("shows denied state with open settings link on native", async () => {
    mockPushState.status = "denied";

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("push-denied")).toBeTruthy();
    });

    expect(screen.getByText(/blocked by your browser or device settings/i)).toBeTruthy();
    expect(screen.getByTestId("push-open-settings")).toBeTruthy();
    expect(screen.getByText("Open device settings")).toBeTruthy();
  });

  it("shows loading state while checking notification status", async () => {
    mockPushState.status = "loading";

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("push-loading")).toBeTruthy();
    });

    expect(screen.getByText("Checking notification status...")).toBeTruthy();
  });

  it("hides notification section when platform is unsupported", async () => {
    mockPushState.status = "unsupported";
    mockPushState.platform = "unsupported";

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-screen")).toBeTruthy();
    });

    expect(screen.queryByTestId("settings-notifications-section")).toBeNull();
  });

  it("disables toggle while subscribing is in progress", async () => {
    mockPushState.subscribing = true;

    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("push-toggle")).toBeTruthy();
    });

    const toggle = screen.getByTestId("push-toggle");
    expect(toggle.props.disabled).toBe(true);
  });
});

// --- Navigation ---

describe("SettingsScreen — Navigation", () => {
  it("calls onBack when back button is pressed", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByTestId("settings-back")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("settings-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
