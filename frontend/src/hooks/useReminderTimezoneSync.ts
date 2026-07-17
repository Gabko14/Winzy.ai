import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchNotificationSettings,
  updateNotificationSettings,
} from "../api/notifications";
import { queryKeys } from "../api/queryKeys";

export function getDeviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * On app start (when authenticated), if habit reminders are on and the stored
 * IANA timezone differs from the device, PUT the current timezone via the
 * existing settings endpoint (travel case).
 */
export function useReminderTimezoneSync(isAuthenticated: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    (async () => {
      try {
        const settings = await fetchNotificationSettings();
        if (cancelled) return;

        queryClient.setQueryData(queryKeys.notifications.settings(), settings);

        if (!settings.habitReminders) return;

        const deviceTz = getDeviceTimezone();
        if (settings.reminderTimezone === deviceTz) return;

        const updated = await updateNotificationSettings({
          reminderTime: settings.reminderTime,
          reminderTimezone: deviceTz,
        });
        if (!cancelled) {
          queryClient.setQueryData(queryKeys.notifications.settings(), updated);
        }
      } catch {
        // Opportunistic sync — ignore failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, queryClient]);
}
