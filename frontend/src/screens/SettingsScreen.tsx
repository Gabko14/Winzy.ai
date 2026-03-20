import React, { useCallback, useEffect, useState } from "react";
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
import { usePushNotifications } from "../hooks/usePushNotifications";
import { Button, Card, Modal } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { useAuth } from "../hooks/useAuth";
import {
  fetchPreferences,
  updateDefaultVisibility,
  type HabitVisibility,
} from "../api/visibility";
import { exportMyData } from "../api/account";
import { isApiError } from "../api";
import { getInitials } from "../utils/getInitials";

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

  // Privacy state
  const [defaultVisibility, setDefaultVisibility] = useState<HabitVisibility>("private");
  const [visibilityLoading, setVisibilityLoading] = useState(true);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  // Appearance state
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme);

  // Data export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Push notifications
  const push = usePushNotifications();

  // Sign out state
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Account deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Load default visibility on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await fetchPreferences();
        if (!cancelled) {
          setDefaultVisibility(prefs.defaultHabitVisibility);
          setVisibilityLoading(false);
        }
      } catch {
        if (!cancelled) {
          setVisibilityLoading(false);
          setVisibilityError("Could not load privacy settings");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVisibilityChange = useCallback(async (visibility: HabitVisibility) => {
    setVisibilitySaving(true);
    setVisibilityError(null);
    const previous = defaultVisibility;
    setDefaultVisibility(visibility);
    try {
      await updateDefaultVisibility(visibility);
    } catch {
      setDefaultVisibility(previous);
      setVisibilityError("Failed to update visibility");
    } finally {
      setVisibilitySaving(false);
    }
  }, [defaultVisibility]);

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
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}
            testID="settings-back"
          >
            <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Settings</Text>
        </View>

        {/* Account Section */}
        <View style={styles.section} testID="settings-account-section">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Account</Text>
          <Card>
            <View style={styles.accountRow}>
              <View style={[styles.avatar, { backgroundColor: colors.brandMuted }]}>
                <Text style={[styles.avatarText, { color: colors.brandPrimary }]}>
                  {getInitials(user.displayName, user.username)}
                </Text>
              </View>
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
              <View
                style={[styles.inlineError, { backgroundColor: colors.errorBackground }]}
                accessibilityRole="alert"
                testID="visibility-error"
              >
                <Text style={[styles.inlineErrorText, { color: colors.error }]}>
                  {visibilityError}
                </Text>
              </View>
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
                    <View
                      style={[styles.inlineError, { backgroundColor: colors.errorBackground }]}
                      accessibilityRole="alert"
                      testID="push-error"
                    >
                      <Text style={[styles.inlineErrorText, { color: colors.error }]}>
                        {push.error}
                      </Text>
                    </View>
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
              <View
                style={[styles.inlineError, { backgroundColor: colors.errorBackground }]}
                accessibilityRole="alert"
                testID="export-error"
              >
                <Text style={[styles.inlineErrorText, { color: colors.error }]}>
                  {exportError}
                </Text>
              </View>
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
              <View
                style={[styles.inlineError, { backgroundColor: colors.errorBackground }]}
                accessibilityRole="alert"
                testID="delete-error"
              >
                <Text style={[styles.inlineErrorText, { color: colors.error }]}>
                  {deleteError}
                </Text>
              </View>
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
            <View
              style={[styles.inlineError, { backgroundColor: colors.errorBackground }]}
              accessibilityRole="alert"
              testID="sign-out-error"
            >
              <Text style={[styles.inlineErrorText, { color: colors.error }]}>
                {signOutError}
              </Text>
            </View>
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
          <View
            style={[styles.inlineError, { backgroundColor: colors.errorBackground }]}
            accessibilityRole="alert"
            testID="delete-modal-error"
          >
            <Text style={[styles.inlineErrorText, { color: colors.error }]}>
              {deleteError}
            </Text>
          </View>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
    paddingTop: spacing["2xl"],
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  backText: {
    fontSize: 24,
  },
  headerTitle: {
    ...typography.h2,
    flex: 1,
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
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    ...typography.body,
    fontWeight: "600",
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
  inlineError: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    marginBottom: spacing.sm,
  },
  inlineErrorText: {
    ...typography.bodySmall,
    fontWeight: "500",
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
