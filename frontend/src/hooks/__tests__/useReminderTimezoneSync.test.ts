import { act } from "@testing-library/react-native";
import { useReminderTimezoneSync } from "../useReminderTimezoneSync";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";
import { queryKeys } from "../../api/queryKeys";

jest.mock("../../api/notifications", () => ({
  fetchNotificationSettings: jest.fn(),
  updateNotificationSettings: jest.fn(),
}));

const {
  fetchNotificationSettings,
  updateNotificationSettings,
} = jest.requireMock("../../api/notifications");

const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

beforeEach(() => {
  jest.clearAllMocks();
  Intl.DateTimeFormat.prototype.resolvedOptions = () =>
    ({ timeZone: "Europe/Vienna" }) as Intl.ResolvedDateTimeFormatOptions;
});

afterEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions;
});

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useReminderTimezoneSync", () => {
  it("does nothing when unauthenticated", async () => {
    renderHookWithQueryClient(() => useReminderTimezoneSync(false));
    await flushPromises();
    expect(fetchNotificationSettings).not.toHaveBeenCalled();
  });

  it("skips PUT when reminders are off", async () => {
    fetchNotificationSettings.mockResolvedValue({
      habitReminders: false,
      friendActivity: true,
      challengeUpdates: true,
      reminderTime: "19:00",
      reminderTimezone: "America/New_York",
    });

    renderHookWithQueryClient(() => useReminderTimezoneSync(true));
    await flushPromises();

    expect(fetchNotificationSettings).toHaveBeenCalledTimes(1);
    expect(updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("skips PUT when stored timezone already matches device", async () => {
    fetchNotificationSettings.mockResolvedValue({
      habitReminders: true,
      friendActivity: true,
      challengeUpdates: true,
      reminderTime: "19:00",
      reminderTimezone: "Europe/Vienna",
    });

    renderHookWithQueryClient(() => useReminderTimezoneSync(true));
    await flushPromises();

    expect(updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("PUTs device timezone when reminders are on and tz differs", async () => {
    fetchNotificationSettings.mockResolvedValue({
      habitReminders: true,
      friendActivity: true,
      challengeUpdates: true,
      reminderTime: "08:00",
      reminderTimezone: "America/New_York",
    });
    updateNotificationSettings.mockResolvedValue({
      habitReminders: true,
      friendActivity: true,
      challengeUpdates: true,
      reminderTime: "08:00",
      reminderTimezone: "Europe/Vienna",
    });

    const { queryClient } = renderHookWithQueryClient(() =>
      useReminderTimezoneSync(true),
    );
    await flushPromises();

    expect(updateNotificationSettings).toHaveBeenCalledWith({
      reminderTime: "08:00",
      reminderTimezone: "Europe/Vienna",
    });
    expect(queryClient.getQueryData(queryKeys.notifications.settings())).toEqual({
      habitReminders: true,
      friendActivity: true,
      challengeUpdates: true,
      reminderTime: "08:00",
      reminderTimezone: "Europe/Vienna",
    });
  });
});
