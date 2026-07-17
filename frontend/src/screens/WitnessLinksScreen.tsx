import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Share,
} from "react-native";
import {
  Button,
  Card,
  TextInput,
  Modal,
  LoadingState,
  ErrorState,
  EmptyState,
  spacing,
  radii,
  typography,
  lightTheme,
} from "../design-system";
import { useWitnessLinks, type WitnessLink } from "../hooks/useWitnessLinks";
import { isApiError } from "../api";

type Props = {
  onBack: () => void;
};

function buildWitnessUrl(token: string): string {
  if (Platform.OS === "web") {
    return `${window.location.origin}/w/${token}`;
  }
  return `https://winzy.ai/w/${token}`;
}

async function copyOrShareUrl(text: string): Promise<boolean> {
  // Web: use Clipboard API
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  // Native: use Share sheet (no clipboard package installed)
  if (Platform.OS !== "web") {
    try {
      await Share.share({ message: text });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function WitnessLinksScreen({ onBack }: Props) {
  const colors = lightTheme;

  const {
    links,
    habits,
    loading,
    error: loadError,
    refresh,
    create,
    creating,
    revoke,
    rotate,
    update,
    updating: saving,
  } = useWitnessLinks();

  const error = loadError?.message ?? null;

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [selectedHabitIds, setSelectedHabitIds] = useState<Set<string>>(new Set());
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal state
  const [editingLink, setEditingLink] = useState<WitnessLink | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editHabitIds, setEditHabitIds] = useState<Set<string>>(new Set());
  const [editError, setEditError] = useState<string | null>(null);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleOpenCreate = useCallback(() => {
    setCreateLabel("");
    setSelectedHabitIds(new Set());
    setCreateError(null);
    setShowCreate(true);
  }, []);

  const handleCreate = useCallback(async () => {
    setCreateError(null);
    try {
      await create({
        label: createLabel.trim() || undefined,
        habitIds: selectedHabitIds.size > 0 ? Array.from(selectedHabitIds) : undefined,
      });
      setShowCreate(false);
    } catch (err) {
      if (isApiError(err)) {
        setCreateError(err.message);
      } else {
        setCreateError("Failed to create link.");
      }
    }
  }, [create, createLabel, selectedHabitIds]);

  // --- Copy ---

  const handleCopy = useCallback(async (link: WitnessLink) => {
    const url = buildWitnessUrl(link.token);
    const success = await copyOrShareUrl(url);
    if (success) {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      Alert.alert("Copy failed", "Could not copy link to clipboard.");
    }
  }, []);

  // --- Revoke ---

  const handleRevoke = useCallback((link: WitnessLink) => {
    const label = link.label || "this link";
    Alert.alert(
      "Revoke witness link?",
      `Anyone with ${label} will immediately lose access. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            try {
              await revoke(link.id);
            } catch (err) {
              const msg = isApiError(err) ? err.message : "Failed to revoke link.";
              Alert.alert("Error", msg);
            }
          },
        },
      ],
    );
  }, [revoke]);

  // --- Rotate ---

  const handleRotate = useCallback((link: WitnessLink) => {
    const label = link.label || "this link";
    Alert.alert(
      "Rotate token?",
      `The current URL for ${label} will stop working. A new URL will be generated.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rotate",
          onPress: async () => {
            try {
              await rotate(link.id);
            } catch (err) {
              const msg = isApiError(err) ? err.message : "Failed to rotate link.";
              Alert.alert("Error", msg);
            }
          },
        },
      ],
    );
  }, [rotate]);

  // --- Edit ---

  const handleOpenEdit = useCallback((link: WitnessLink) => {
    setEditingLink(link);
    setEditLabel(link.label ?? "");
    setEditHabitIds(new Set(link.habitIds));
    setEditError(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingLink) return;
    setEditError(null);
    try {
      await update(editingLink.id, {
        label: editLabel.trim(),
        habitIds: Array.from(editHabitIds),
      });
      setEditingLink(null);
    } catch (err) {
      if (isApiError(err)) {
        setEditError(err.message);
      } else {
        setEditError("Failed to save changes.");
      }
    }
  }, [editingLink, editLabel, editHabitIds, update]);

  // --- Habit toggle helper ---

  const toggleHabitId = useCallback((habitId: string, set: Set<string>, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(habitId)) {
      next.delete(habitId);
    } else {
      next.add(habitId);
    }
    setter(next);
  }, []);

  // --- Render ---

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="witness-links-loading">
        <View style={styles.header}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton} testID="witness-links-back">
            <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Witness Links</Text>
        </View>
        <View style={styles.center}>
          <LoadingState message="Loading your witness links..." />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="witness-links-error">
        <View style={styles.header}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton} testID="witness-links-back">
            <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Witness Links</Text>
        </View>
        <View style={styles.center}>
          <ErrorState message={error} onRetry={refresh} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="witness-links-screen">
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton} testID="witness-links-back">
            <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Witness Links</Text>
        </View>

        {/* Description */}
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Share a private link with someone you trust. They can see your selected habit flames without needing an account.
        </Text>

        {/* Create button */}
        <View style={styles.createButton}>
          <Button
            title="Create witness link"
            onPress={handleOpenCreate}
            size="lg"
          />
        </View>

        {/* Links list */}
        {links.length === 0 ? (
          <EmptyState
            title="No witness links yet"
            message="Create a link to share your flame with someone you trust."
          />
        ) : (
          <View style={styles.linksList}>
            {links.map((link) => (
              <Card key={link.id} style={styles.linkCard}>
                <View style={styles.linkHeader}>
                  <Text style={[styles.linkLabel, { color: colors.textPrimary }]} testID={`link-label-${link.id}`}>
                    {link.label || "Unnamed link"}
                  </Text>
                  <Text style={[styles.linkHabitCount, { color: colors.textTertiary }]}>
                    {link.habitIds.length} {link.habitIds.length === 1 ? "habit" : "habits"}
                  </Text>
                </View>

                <View style={styles.linkActions}>
                  <Pressable
                    onPress={() => handleCopy(link)}
                    style={[styles.actionChip, { borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Copy link"
                    testID={`copy-link-${link.id}`}
                  >
                    <Text style={[styles.actionChipText, { color: colors.brandPrimary }]}>
                      {copiedId === link.id ? "Copied!" : Platform.OS === "web" ? "Copy link" : "Share link"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleOpenEdit(link)}
                    style={[styles.actionChip, { borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Edit link"
                    testID={`edit-link-${link.id}`}
                  >
                    <Text style={[styles.actionChipText, { color: colors.textPrimary }]}>Edit</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleRotate(link)}
                    style={[styles.actionChip, { borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Rotate link"
                    testID={`rotate-link-${link.id}`}
                  >
                    <Text style={[styles.actionChipText, { color: colors.textPrimary }]}>Rotate</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleRevoke(link)}
                    style={[styles.actionChip, { borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Revoke link"
                    testID={`revoke-link-${link.id}`}
                  >
                    <Text style={[styles.actionChipText, { color: colors.error }]}>Revoke</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Create Modal */}
      <Modal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create witness link"
      >
        <TextInput
          label="Label (optional)"
          placeholder="e.g. Maya, Coach Sam"
          value={createLabel}
          onChangeText={setCreateLabel}
          maxLength={100}
          testID="create-link-label"
        />

        {habits.length > 0 && (
          <View style={styles.habitSelection}>
            <Text style={[styles.habitSelectionTitle, { color: colors.textPrimary }]}>
              Select habits to share
            </Text>
            <Text style={[styles.habitSelectionHint, { color: colors.textTertiary }]}>
              Only selected habits will be visible through this link
            </Text>
            {habits.map((habit) => (
              <Pressable
                key={habit.id}
                onPress={() => toggleHabitId(habit.id, selectedHabitIds, setSelectedHabitIds)}
                style={[
                  styles.habitOption,
                  {
                    backgroundColor: selectedHabitIds.has(habit.id) ? colors.brandMuted : "transparent",
                    borderColor: selectedHabitIds.has(habit.id) ? colors.brandPrimary : colors.border,
                  },
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedHabitIds.has(habit.id) }}
                testID={`create-habit-${habit.id}`}
              >
                <Text style={[styles.habitOptionText, { color: colors.textPrimary }]}>
                  {habit.icon ? `${habit.icon} ` : ""}{habit.name}
                </Text>
                {selectedHabitIds.has(habit.id) && (
                  <Text style={[styles.checkmark, { color: colors.brandPrimary }]}>✓</Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {createError && (
          <View style={[styles.inlineError, { backgroundColor: colors.errorBackground }]} accessibilityRole="alert" testID="create-link-error">
            <Text style={[styles.inlineErrorText, { color: colors.error }]}>{createError}</Text>
          </View>
        )}

        <View style={styles.modalActions}>
          <Button
            title="Cancel"
            onPress={() => setShowCreate(false)}
            variant="secondary"
            size="lg"
            disabled={creating}
          />
          <Button
            title={creating ? "Creating..." : "Create link"}
            onPress={handleCreate}
            size="lg"
            disabled={creating}
            loading={creating}
          />
        </View>
      </Modal>

      {/* Edit Modal */}
      <Modal
        visible={editingLink !== null}
        onClose={() => setEditingLink(null)}
        title="Edit witness link"
      >
        <TextInput
          label="Label"
          placeholder="e.g. Maya, Coach Sam"
          value={editLabel}
          onChangeText={setEditLabel}
          maxLength={100}
          testID="edit-link-label"
        />

        {habits.length > 0 && (
          <View style={styles.habitSelection}>
            <Text style={[styles.habitSelectionTitle, { color: colors.textPrimary }]}>
              Habits to share
            </Text>
            {habits.map((habit) => (
              <Pressable
                key={habit.id}
                onPress={() => toggleHabitId(habit.id, editHabitIds, setEditHabitIds)}
                style={[
                  styles.habitOption,
                  {
                    backgroundColor: editHabitIds.has(habit.id) ? colors.brandMuted : "transparent",
                    borderColor: editHabitIds.has(habit.id) ? colors.brandPrimary : colors.border,
                  },
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: editHabitIds.has(habit.id) }}
                testID={`edit-habit-${habit.id}`}
              >
                <Text style={[styles.habitOptionText, { color: colors.textPrimary }]}>
                  {habit.icon ? `${habit.icon} ` : ""}{habit.name}
                </Text>
                {editHabitIds.has(habit.id) && (
                  <Text style={[styles.checkmark, { color: colors.brandPrimary }]}>✓</Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {editError && (
          <View style={[styles.inlineError, { backgroundColor: colors.errorBackground }]} accessibilityRole="alert" testID="edit-link-error">
            <Text style={[styles.inlineErrorText, { color: colors.error }]}>{editError}</Text>
          </View>
        )}

        <View style={styles.modalActions}>
          <Button
            title="Cancel"
            onPress={() => setEditingLink(null)}
            variant="secondary"
            size="lg"
            disabled={saving}
          />
          <Button
            title={saving ? "Saving..." : "Save changes"}
            onPress={handleSaveEdit}
            size="lg"
            disabled={saving}
            loading={saving}
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
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
  description: {
    ...typography.body,
    marginBottom: spacing.xl,
  },
  createButton: {
    marginBottom: spacing.xl,
  },
  linksList: {
    gap: spacing.md,
  },
  linkCard: {
    marginBottom: spacing.sm,
  },
  linkHeader: {
    marginBottom: spacing.md,
  },
  linkLabel: {
    ...typography.body,
    fontWeight: "600",
  },
  linkHabitCount: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
  },
  linkActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  actionChipText: {
    ...typography.bodySmall,
    fontWeight: "500",
  },
  habitSelection: {
    marginTop: spacing.base,
    gap: spacing.sm,
  },
  habitSelectionTitle: {
    ...typography.body,
    fontWeight: "600",
  },
  habitSelectionHint: {
    ...typography.bodySmall,
    marginBottom: spacing.xs,
  },
  habitOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  habitOptionText: {
    ...typography.body,
    flex: 1,
  },
  checkmark: {
    ...typography.body,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  inlineError: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    marginTop: spacing.sm,
  },
  inlineErrorText: {
    ...typography.bodySmall,
    fontWeight: "500",
  },
  modalActions: {
    marginTop: spacing.base,
    gap: spacing.sm,
  },
});
