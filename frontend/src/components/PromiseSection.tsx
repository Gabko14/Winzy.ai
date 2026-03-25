import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  TextInput as RNTextInput,
} from "react-native";
import { Card, Badge, Button } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { usePromises } from "../hooks/usePromises";
import { isApiError } from "../api";
import type { FlamePromise } from "../api/promises";

type Props = {
  habitId: string;
  timezone: string;
};

function getStatusLabel(status: FlamePromise["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "kept":
      return "Kept";
    case "endedbelow":
      return "Ended below promise";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function getStatusVariant(
  status: FlamePromise["status"],
): "success" | "warning" | "default" | "info" {
  switch (status) {
    case "active":
      return "info";
    case "kept":
      return "success";
    case "endedbelow":
      return "warning";
    case "cancelled":
      return "default";
    default:
      return "default";
  }
}

// --- Create Promise Form ---

type CreateFormProps = {
  onSubmit: (target: number, endDate: string, note?: string) => Promise<void>;
};

function CreatePromiseForm({ onSubmit }: CreateFormProps) {
  const colors = lightTheme;
  const [target, setTarget] = useState("70");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const targetNum = Number(target);
    if (isNaN(targetNum) || targetNum < 1 || targetNum > 100) {
      setError("Target must be between 1% and 100%");
      return;
    }
    if (!endDate) {
      setError("Please set an end date");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(targetNum, endDate, note || undefined);
    } catch (err) {
      const message = isApiError(err)
        ? err.message
        : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View testID="create-promise-form">
      <Text
        style={[styles.formLabel, { color: colors.textSecondary }]}
      >
        Target consistency (%)
      </Text>
      <RNTextInput
        testID="promise-target-input"
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.border,
            backgroundColor: colors.backgroundSecondary,
          },
        ]}
        value={target}
        onChangeText={setTarget}
        keyboardType="numeric"
        placeholder="70"
        placeholderTextColor={colors.textTertiary}
      />

      <Text
        style={[styles.formLabel, { color: colors.textSecondary }]}
      >
        End date (YYYY-MM-DD)
      </Text>
      <RNTextInput
        testID="promise-enddate-input"
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.border,
            backgroundColor: colors.backgroundSecondary,
          },
        ]}
        value={endDate}
        onChangeText={setEndDate}
        placeholder="2026-04-30"
        placeholderTextColor={colors.textTertiary}
      />

      <Text
        style={[styles.formLabel, { color: colors.textSecondary }]}
      >
        Private note (optional)
      </Text>
      <RNTextInput
        testID="promise-note-input"
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.border,
            backgroundColor: colors.backgroundSecondary,
          },
        ]}
        value={note}
        onChangeText={setNote}
        placeholder="A personal reminder..."
        placeholderTextColor={colors.textTertiary}
        multiline
      />

      {error && (
        <Text
          style={[styles.formError, { color: colors.error }]}
          testID="promise-form-error"
        >
          {error}
        </Text>
      )}

      <View testID="promise-submit-button">
        <Button
          title="Make promise"
          onPress={handleSubmit}
          variant="primary"
          size="md"
          loading={submitting}
          disabled={submitting}
          accessibilityLabel="Make a flame promise"
        />
      </View>
    </View>
  );
}

// --- Active Promise Display ---

type ActiveProps = {
  promise: FlamePromise;
  onCancel: () => void;
  cancelling: boolean;
  onToggleVisibility: (isPublic: boolean) => Promise<void>;
};

function ActivePromiseDisplay({ promise, onCancel, cancelling, onToggleVisibility }: ActiveProps) {
  const colors = lightTheme;
  const [togglingVisibility, setTogglingVisibility] = useState(false);

  const handleCancel = () => {
    if (Platform.OS === "web") {
      onCancel();
    } else {
      Alert.alert(
        "Cancel promise",
        "Are you sure you want to cancel this promise?",
        [
          { text: "Keep it", style: "cancel" },
          { text: "Cancel promise", onPress: onCancel, style: "destructive" },
        ],
      );
    }
  };

  return (
    <View testID="active-promise">
      <Text
        style={[styles.promiseStatement, { color: colors.textPrimary }]}
        testID="promise-statement"
      >
        {promise.statement}
      </Text>

      <View style={styles.promiseMetaRow}>
        <Badge
          label={promise.onTrack ? "On track" : "Below target"}
          variant={promise.onTrack ? "success" : "warning"}
          testID="promise-track-badge"
        />
        {promise.currentConsistency !== null && (
          <Text
            style={[styles.promiseConsistency, { color: colors.textSecondary }]}
            testID="promise-current-consistency"
          >
            Current: {Math.round(promise.currentConsistency)}%
          </Text>
        )}
      </View>

      <Text
        style={[styles.promiseEndDate, { color: colors.textTertiary }]}
        testID="promise-end-date"
      >
        Through {promise.endDate}
      </Text>

      {promise.privateNote && (
        <Text
          style={[styles.promiseNote, { color: colors.textSecondary }]}
          testID="promise-private-note"
        >
          {promise.privateNote}
        </Text>
      )}

      <Pressable
        onPress={async () => {
          setTogglingVisibility(true);
          try {
            await onToggleVisibility(!promise.isPublicOnFlame);
          } finally {
            setTogglingVisibility(false);
          }
        }}
        disabled={togglingVisibility}
        style={styles.visibilityToggle}
        testID="promise-visibility-toggle"
        accessibilityLabel={
          promise.isPublicOnFlame
            ? "Hide promise from public flame"
            : "Show promise on public flame"
        }
      >
        <Text style={[styles.visibilityText, { color: colors.textSecondary }]}>
          {promise.isPublicOnFlame ? "Visible on flame" : "Hidden from flame"}
        </Text>
        <Badge
          label={promise.isPublicOnFlame ? "Public" : "Private"}
          variant={promise.isPublicOnFlame ? "info" : "default"}
          testID="promise-visibility-badge"
        />
      </Pressable>

      <Pressable
        onPress={handleCancel}
        disabled={cancelling}
        style={styles.cancelLink}
        testID="cancel-promise-button"
        accessibilityLabel="Cancel this promise"
      >
        <Text style={[styles.cancelText, { color: colors.textTertiary }]}>
          Cancel promise
        </Text>
      </Pressable>
    </View>
  );
}

// --- History ---

type HistoryProps = {
  promises: FlamePromise[];
};

function PromiseHistory({ promises }: HistoryProps) {
  const colors = lightTheme;

  if (promises.length === 0) return null;

  return (
    <View testID="promise-history">
      <Text
        style={[styles.historyTitle, { color: colors.textSecondary }]}
      >
        Past promises
      </Text>
      {promises.map((p) => (
        <View key={p.id} style={styles.historyItem} testID={`promise-history-${p.id}`}>
          <View style={styles.historyRow}>
            <Text style={[styles.historyStatement, { color: colors.textPrimary }]}>
              {p.statement}
            </Text>
            <Badge
              label={getStatusLabel(p.status)}
              variant={getStatusVariant(p.status)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// --- Main Section ---

export function PromiseSection({ habitId, timezone }: Props) {
  const colors = lightTheme;
  const { data, loading, error, refresh, create, cancel, toggleVisibility } = usePromises(habitId, timezone);
  const [showForm, setShowForm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleCreate = async (target: number, endDate: string, note?: string) => {
    await create({ targetConsistency: target, endDate, privateNote: note });
    setShowForm(false);
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancel();
    } catch {
      Alert.alert("Could not cancel", "Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !data) return null; // Don't show skeleton for promises section
  if (error && !data) return (
    <View style={styles.card}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Flame Promise</Text>
      <Text style={[styles.emptyText, { color: colors.error }]}>Could not load promises</Text>
      <Button title="Retry" onPress={refresh} variant="ghost" size="sm" />
    </View>
  );

  const activePromise = data?.active ?? null;
  const history = data?.history ?? [];

  return (
    <View testID="promise-section">
    <Card style={styles.card}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
        Flame Promise
      </Text>

      {activePromise ? (
        <ActivePromiseDisplay
          promise={activePromise}
          onCancel={handleCancel}
          cancelling={cancelling}
          onToggleVisibility={toggleVisibility}
        />
      ) : showForm ? (
        <CreatePromiseForm onSubmit={handleCreate} />
      ) : (
        <View testID="no-active-promise">
          <Text
            style={[styles.emptyText, { color: colors.textSecondary }]}
          >
            Make a promise to yourself about this habit
          </Text>
          <View testID="create-promise-button">
            <Button
              title="Create promise"
              onPress={() => setShowForm(true)}
              variant="secondary"
              size="sm"
              accessibilityLabel="Create a flame promise"
            />
          </View>
        </View>
      )}

      <PromiseHistory promises={history} />
    </Card>
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.base,
  },
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.md,
  },

  // Active promise
  promiseStatement: {
    ...typography.body,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  promiseMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  promiseConsistency: {
    ...typography.bodySmall,
  },
  promiseEndDate: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  promiseNote: {
    ...typography.bodySmall,
    fontStyle: "italic",
    marginBottom: spacing.sm,
  },
  visibilityToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  visibilityText: {
    ...typography.bodySmall,
  },
  cancelLink: {
    marginTop: spacing.xs,
  },
  cancelText: {
    ...typography.bodySmall,
    textDecorationLine: "underline",
  },

  // Empty state
  emptyText: {
    ...typography.body,
    marginBottom: spacing.md,
  },

  // Form
  formLabel: {
    ...typography.caption,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  formError: {
    ...typography.bodySmall,
    marginBottom: spacing.sm,
  },

  // History
  historyTitle: {
    ...typography.caption,
    fontWeight: "600",
    marginTop: spacing.base,
    marginBottom: spacing.sm,
  },
  historyItem: {
    marginBottom: spacing.sm,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  historyStatement: {
    ...typography.bodySmall,
    flex: 1,
  },
});
