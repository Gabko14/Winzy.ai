import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Platform,
  Linking,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { getDeviceTimezone } from "../hooks/useReminderTimezoneSync";
import { ReminderTimePicker } from "../components/ReminderTimePicker";
import { Button, Card, Modal, Avatar, ScreenHeader, InlineError } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { useAuth } from "../hooks/useAuth";
import {
  fetchPreferences,
  updateDefaultVisibility,
  type HabitVisibility,
} from "../api/visibility";
import {
  fetchNotificationSettings,
  updateNotificationSettings,
  type UpdateNotificationSettingsRequest,
} from "../api/notifications";
import { queryKeys } from "../api/queryKeys";
import { exportMyData } from "../api/account";
import { isApiError } from "../api";
import { getInitials } from "../utils/getInitials";
import { resolveAvatarUrl } from "../utils/avatarUrl";

const DEFAULT_REMINDER_TIME = "19:00";
const REMINDER_COPY =
  "A gentle nudge if you haven't logged yet — never when you're already done.";

const APP_VERSION = "1.0.0";

type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "winzy_theme_preference";

function getStoredTheme(): ThemePreference {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  }
  return "system";
}

function storeTheme(theme: ThemePreference): void {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

type Props = {
  onBack: () => void;
  onEditProfile: () => void;
};

type VisibilityOption = { value: HabitVisibility; label: string; description: string };

const visibilityOptions: VisibilityOption[] = [
  { value: "private", label: "Private", description: "Only you can see your habits" },
  { value: "friends", label: "Friends", description: "Friends can see your habits" },
  { value: "public", label: "Public", description: "Anyone can see your habits" },
];

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function SettingsScreen({ onBack, onEditProfile }: Props) {
  const auth = useAuth();
  const colors = lightTheme;
  const queryClient = useQueryClient();

  const preferencesQuery = useQuery({
    queryKey: queryKeys.visibility.preferences(),
    queryFn: fetchPreferences,
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: HabitVisibility) => updateDefaultVisibility(visibility),
    onSuccess: (prefs) => {
      queryClient.setQueryData(queryKeys.visibility.preferences(), prefs);
    },
  });

  const defaultVisibility: HabitVisibility =
    preferencesQuery.data?.defaultHabitVisibility ?? "private";
  const visibilityLoading = preferencesQuery.isPending;
  const visibilityError = preferencesQuery.isError
    ? "Could not load privacy settings"
    : visibilityMutation.isError
      ? "Failed to update visibility"
      : null;
  const visibilitySaving = visibilityMutation.isPending;

  // Appearance state
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme);

  // Data export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Push notifications
  const push = usePushNotifications();

  const notificationSettingsQuery = useQuery({
    queryKey: queryKeys.notifications.settings(),
    queryFn: fetchNotificationSettings,
  });

  const notificationSettingsMutation = useMutation({
    mutationFn: (body: UpdateNotificationSettingsRequest) =>
      updateNotificationSettings(body),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.notifications.settings(), settings);
    },
  });

  const habitReminders = notificationSettingsQuery.data?.habitReminders ?? false;
  const reminderTime =
    notificationSettingsQuery.data?.reminderTime ?? DEFAULT_REMINDER_TIME;
  const reminderSettingsSaving = notificationSettingsMutation.isPending;
  const reminderSettingsError = notificationSettingsMutation.isError
    ? "Failed to update reminder settings"
    : null;

  // Sign out state
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Account deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleVisibilityChange = useCallback(
    async (visibility: HabitVisibility) => {
      try {
        await visibilityMutation.mutateAsync(visibility);
      } catch {
        // Error surfaced via visibilityMutation.isError
      }
    },
    [visibilityMutation],
  );

  const handleThemeChange = useCallback((newTheme: ThemePreference) => {
    setTheme(newTheme);
    storeTheme(newTheme);
  }, []);

  const handlePushToggle = useCallback(async (value: boolean) => {
    if (value) {
      await push.subscribe();
    } else {
      await push.unsubscribe();
    }
  }, [push]);

  const saveReminderSettings = useCallback(
    async (patch: UpdateNotificationSettingsRequest) => {
      try {
        await notificationSettingsMutation.mutateAsync({
          ...patch,
          reminderTime: patch.reminderTime ?? reminderTime,
          reminderTimezone: getDeviceTimezone(),
        });
      } catch {
        // Error surfaced via notificationSettingsMutation.isError
      }
    },
    [notificationSettingsMutation, reminderTime],
  );

  const handleHabitRemindersToggle = useCallback(
    (value: boolean) => {
      void saveReminderSettings({
        habitReminders: value,
        reminderTime,
      });
    },
    [reminderTime, saveReminderSettings],
  );

  const handleReminderTimeChange = useCallback(
    (nextTime: string) => {
      void saveReminderSettings({
        habitReminders: true,
        reminderTime: nextTime,
      });
    },
    [saveReminderSettings],
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const bundle = await exportMyData();
      // Trigger download on web
      if (Platform.OS === "web") {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `winzy-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (isApiError(err)) {
        setExportError(err.message);
      } else {
        setExportError("Failed to export data");
      }
    } finally {
      setExporting(false);
    }
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      // auth.deleteAccount() calls DELETE /auth/account, clears tokens, and sets state to unauthenticated
      await auth.deleteAccount();
      setShowDeleteConfirm(false);
    } catch (err) {
      if (isApiError(err)) {
        setDeleteError(err.message);
      } else {
        setDeleteError("Failed to delete account");
      }
    } finally {
      setDeleting(false);
    }
  }, [auth]);

  const handleSignOut = useCallback(async () => {
    if (auth.status !== "authenticated") return;
    setSignOutError(null);
    try {
      await auth.logout();
    } catch (err) {
      if (isApiError(err)) {
        setSignOutError(err.message);
      } else {
        setSignOutError("Sign out failed. Please check your connection and try again.");
      }
    }
  }, [auth]);

  if (auth.status !== "authenticated") return null;

  const { user } = auth;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="settings-screen">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <ScreenHeader title="Settings" onBack={onBack} backTestID="settings-back" style={styles.headerStyle} />

        {/* Account Section */}
        <View style={styles.section} testID="settings-account-section">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Account</Text>
          <Card>
            <View style={styles.accountRow}>
              <Avatar
                initials={getInitials(user.displayName, user.username)}
                size="base"
                imageUrl={resolveAvatarUrl(user.avatarUrl)}
              />
              <View style={styles.accountInfo}>
                <Text style={[styles.accountName, { color: colors.textPrimary }]} testID="settings-display-name">
                  {user.displayName || user.username}
                </Text>
                <Text style={[styles.accountEmail, { color: colors.textSecondary }]} testID="settings-email">
                  {user.email}
                </Text>
              </View>
              <Pressable
                onPress={onEditProfile}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                testID="settings-edit-profile"
              >
                <Text style={[styles.linkText, { color: colors.brandPrimary }]}>Edit</Text>
              </Pressable>
            </View>
          </Card>
        </View>

        {/* Privacy Section */}
        <View style={styles.section} testID="settings-privacy-section">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Privacy</Text>
          <Card>
            <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>
              Default visibility for new habits
            </Text>
            <Text style={[styles.settingHint, { color: colors.textTertiary }]}>
              Changing this only affects habits you create after this point
            </Text>

            {visibilityError && (
              <InlineError message={visibilityError} testID="visibility-error" />
            )}

            <View style={styles.optionGroup}>
              {visibilityOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => handleVisibilityChange(opt.value)}
                  disabled={visibilityLoading || visibilitySaving}
                  style={[
                    styles.optionRow,
                    {
                      backgroundColor:
                        defaultVisibility === opt.value
                          ? colors.brandMuted
                          : "transparent",
                      borderColor:
                        defaultVisibility === opt.value
                          ? colors.brandPrimary
                          : colors.border,
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: defaultVisibility === opt.value }}
                  testID={`visibility-option-${opt.value}`}
                >
                  <View style={styles.optionContent}>
                    <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
                      {opt.description}
                    </Text>
                  </View>
                  {defaultVisibility === opt.value && (
                    <Text style={[styles.checkmark, { color: colors.brandPrimary }]} testID={`visibility-check-${opt.value}`}>
                      ✓
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          </Card>
        </View>

        {/* Appearance Section */}
        <View style={styles.section} testID="settings-appearance-section">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Appearance</Text>
          <Card>
            <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>Theme</Text>
            <View style={styles.themeGroup}>
              {themeOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => handleThemeChange(opt.value)}
                  style={[
                    styles.themeOption,
                    {
                      backgroundColor:
                        theme === opt.value ? colors.brandMuted : "transparent",
                      borderColor:
                        theme === opt.value ? colors.brandPrimary : colors.border,
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: theme === opt.value }}
                  testID={`theme-option-${opt.value}`}
                >
                  <Text
                    style={[
                      styles.themeLabel,
                      {
                        color:
                          theme === opt.value
                            ? colors.brandPrimary
                            : colors.textPrimary,
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Card>
        </View>

        {/* Notifications Section */}
        {push.status !== "unsupported" && (
          <View style={styles.section} testID="settings-notifications-section">
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Notifications
            </Text>
            <Card>
              {push.status === "loading" ? (
                <Text
                  style={[styles.settingHint, { color: colors.textTertiary, marginBottom: 0 }]}
                  testID="push-loading"
                >
                  Checking notification status...
                </Text>
              ) : push.status === "denied" ? (
                <View testID="push-denied">
                  <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>
                    Push notifications
                  </Text>
                  <Text style={[styles.settingHint, { color: colors.textTertiary }]}>
                    Notifications are blocked by your browser or device settings.
                  </Text>
                  {Platform.OS === "web" ? (
                    <Text
                      style={[styles.settingHint, { color: colors.textSecondary, marginBottom: 0 }]}
                      testID="push-denied-instructions"
                    >
                      To enable, click the lock icon in your browser's address bar and allow notifications for this site.
                    </Text>
                  ) : (
                    <Pressable
                      onPress={() => Linking.openSettings()}
                      accessibilityRole="button"
                      testID="push-open-settings"
                    >
                      <Text style={[styles.linkText, { color: colors.brandPrimary }]}>
                        Open device settings
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View testID="push-toggle-row">
                  {push.error && (
                    <InlineError message={push.error} testID="push-error" />
                  )}
                  <View style={styles.pushRow}>
                    <View style={styles.actionContent}>
                      <Text style={[styles.settingLabel, { color: colors.textPrimary, marginBottom: 0 }]}>
                        Push notifications
                      </Text>
                      <Text style={[styles.settingHint, { color: colors.textTertiary, marginBottom: 0 }]}>
                        {push.status === "subscribed"
                          ? "You'll receive reminders and friend activity"
                          : "Get reminders and friend activity updates"}
                      </Text>
                    </View>
                    <Switch
                      value={push.status === "subscribed"}
                      onValueChange={handlePushToggle}
                      disabled={push.subscribing}
                      trackColor={{ false: colors.border, true: colors.brandPrimary }}
                      accessibilityRole="switch"
                      accessibilityLabel="Push notifications"
                      accessibilityState={{ checked: push.status === "subscribed" }}
                      testID="push-toggle"
                    />
                  </View>
                </View>
              )}

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <View testID="habit-reminders-section">
                {reminderSettingsError && (
                  <InlineError message={reminderSettingsError} testID="habit-reminders-error" />
                )}
                <View style={styles.pushRow}>
                  <View style={styles.actionContent}>
                    <Text style={[styles.settingLabel, { color: colors.textPrimary, marginBottom: 0 }]}>
                      Habit reminders
                    </Text>
                    <Text style={[styles.settingHint, { color: colors.textTertiary, marginBottom: 0 }]}>
                      {REMINDER_COPY}
                    </Text>
                  </View>
                  <Switch
                    value={habitReminders}
                    onValueChange={handleHabitRemindersToggle}
                    disabled={
                      notificationSettingsQuery.isPending || reminderSettingsSaving
                    }
                    trackColor={{ false: colors.border, true: colors.brandPrimary }}
                    accessibilityRole="switch"
                    accessibilityLabel="Habit reminders"
                    accessibilityState={{ checked: habitReminders }}
                    testID="habit-reminders-toggle"
                  />
                </View>

                {habitReminders && (
                  <View style={styles.habitReminderDetails} testID="habit-reminder-details">
                    {push.status === "subscribed" ? (
                      <View testID="habit-reminder-time-row">
                        <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>
                          Reminder time
                        </Text>
                        <ReminderTimePicker
                          value={reminderTime}
                          onChange={handleReminderTimeChange}
                          disabled={reminderSettingsSaving}
                        />
                      </View>
                    ) : push.status === "denied" ? (
                      <Text
                        style={[styles.settingHint, { color: colors.textSecondary, marginBottom: 0 }]}
                        testID="habit-reminder-needs-permission"
                      >
                        Reminders need notifications enabled. Allow notifications above to receive them.
                      </Text>
                    ) : push.status === "loading" ? null : (
                      <View testID="habit-reminder-needs-subscribe">
                        <Text style={[styles.settingHint, { color: colors.textSecondary }]}>
                          Reminders need notifications enabled.
                        </Text>
                        <Pressable
                          onPress={() => {
                            void push.subscribe();
                          }}
                          disabled={push.subscribing}
                          accessibilityRole="button"
                          accessibilityLabel="Enable notifications"
                          testID="habit-reminder-enable-push"
                        >
                          <Text style={[styles.linkText, { color: colors.brandPrimary }]}>
                            {push.subscribing ? "Enabling..." : "Enable notifications"}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </Card>
          </View>
        )}

        {/* About Section */}
        <View style={styles.section} testID="settings-about-section">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>About</Text>
          <Card>
            <View style={styles.aboutRow}>
              <Text style={[styles.aboutLabel, { color: colors.textPrimary }]}>Version</Text>
              <Text style={[styles.aboutValue, { color: colors.textSecondary }]} testID="settings-version">
                {APP_VERSION}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                const url = "https://winzy.ai/privacy";
                if (Platform.OS === "web") {
                  window.open(url, "_blank");
                } else {
                  Linking.openURL(url);
                }
              }}
              style={styles.aboutRow}
              accessibilityRole="link"
              accessibilityHint="Opens privacy policy in your browser"
              testID="settings-privacy-policy"
            >
              <Text style={[styles.aboutLabel, { color: colors.textPrimary }]}>Privacy policy</Text>
              <Text style={[styles.linkText, { color: colors.brandPrimary }]}>View</Text>
            </Pressable>
          </Card>
        </View>

        {/* Data & Account Section */}
        <View style={styles.section} testID="settings-data-section">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Data & Account</Text>
          <Card>
            {exportError && (
              <InlineError message={exportError} testID="export-error" />
            )}
            <Pressable
              onPress={handleExport}
              disabled={exporting}
              style={styles.actionRow}
              accessibilityRole="button"
              testID="settings-export-data"
            >
              <View style={styles.actionContent}>
                <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>
                  Export my data
                </Text>
                <Text style={[styles.actionHint, { color: colors.textTertiary }]}>
                  Download all your data as JSON
                </Text>
              </View>
              <Text style={[styles.linkText, { color: colors.brandPrimary }]}>
                {exporting ? "Exporting..." : "Export"}
              </Text>
            </Pressable>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {deleteError && (
              <InlineError message={deleteError} testID="delete-error" />
            )}
            <Pressable
              onPress={() => setShowDeleteConfirm(true)}
              style={styles.actionRow}
              accessibilityRole="button"
              testID="settings-delete-account"
            >
              <View style={styles.actionContent}>
                <Text style={[styles.actionLabel, { color: colors.error }]}>
                  Delete account
                </Text>
                <Text style={[styles.actionHint, { color: colors.textTertiary }]}>
                  Permanently delete your account and all data
                </Text>
              </View>
            </Pressable>
          </Card>
        </View>

        {/* Help Section */}
        <View style={styles.section} testID="settings-help-section">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Help</Text>
          <Card>
            <View style={styles.actionRow}>
              <Text style={[styles.actionLabel, { color: colors.textTertiary }]}>
                Replay onboarding
              </Text>
              <Text style={[styles.comingSoon, { color: colors.textTertiary }]}>
                Coming soon
              </Text>
            </View>
          </Card>
        </View>

        {/* Sign Out */}
        <View style={styles.section} testID="settings-sign-out">
          {signOutError && (
            <InlineError message={signOutError} testID="sign-out-error" />
          )}
          <Button
            title="Sign out"
            onPress={handleSignOut}
            variant="ghost"
            size="lg"
          />
        </View>
      </ScrollView>

      {/* Delete account confirmation modal */}
      <Modal
        visible={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete account?"
      >
        <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
          This will permanently delete your account and all associated data. This action cannot be undone.
        </Text>
        {deleteError && (
          <InlineError message={deleteError} testID="delete-modal-error" />
        )}
        <View style={styles.modalActions}>
          <Button
            title="Cancel"
            onPress={() => setShowDeleteConfirm(false)}
            variant="secondary"
            size="lg"
            disabled={deleting}
          />
          <Button
            title={deleting ? "Deleting..." : "Delete my account"}
            onPress={handleDeleteAccount}
            variant="primary"
            size="lg"
            disabled={deleting}
            loading={deleting}
            accessibilityLabel="Permanently delete your account"
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.base,
    paddingBottom: spacing["3xl"],
    maxWidth: 500,
    width: "100%",
    alignSelf: "center",
  },
  headerStyle: {
    marginBottom: spacing.xl,
    paddingTop: spacing["2xl"],
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    ...typography.body,
    fontWeight: "600",
  },
  accountEmail: {
    ...typography.bodySmall,
  },
  linkText: {
    ...typography.body,
    fontWeight: "500",
  },
  settingLabel: {
    ...typography.body,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  settingHint: {
    ...typography.bodySmall,
    marginBottom: spacing.base,
  },
  optionGroup: {
    gap: spacing.sm,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    ...typography.body,
    fontWeight: "500",
  },
  optionDescription: {
    ...typography.bodySmall,
  },
  checkmark: {
    ...typography.body,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  themeGroup: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  themeOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  themeLabel: {
    ...typography.body,
    fontWeight: "500",
  },
  pushRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  habitReminderDetails: {
    marginTop: spacing.base,
  },
  aboutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  aboutLabel: {
    ...typography.body,
  },
  aboutValue: {
    ...typography.body,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  actionContent: {
    flex: 1,
  },
  actionLabel: {
    ...typography.body,
    fontWeight: "500",
  },
  actionHint: {
    ...typography.bodySmall,
  },
  divider: {
    height: 1,
    marginVertical: spacing.sm,
  },
  comingSoon: {
    ...typography.bodySmall,
    fontStyle: "italic",
  },
  modalBody: {
    ...typography.body,
    marginBottom: spacing.base,
  },
  modalActions: {
    gap: spacing.sm,
  },
});
