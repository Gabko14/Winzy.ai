import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import {
  Modal,
  TextInput,
  Button,
  spacing,
  typography,
  lightTheme,
} from "../design-system";
import type { Todo } from "../api/todos";

type Props = {
  todo: Todo | null;
  visible: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (id: string, patch: { title: string; dueDate: string | null }) => Promise<void>;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function TodoEditSheet({ todo, visible, saving, onClose, onSave }: Props) {
  const colors = lightTheme;
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!todo || !visible) return;
    setTitle(todo.title);
    setDueDate(todo.dueDate ?? "");
    setError(null);
  }, [todo, visible]);

  const handleClearDue = useCallback(() => setDueDate(""), []);

  const handleSave = useCallback(async () => {
    if (!todo) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required");
      return;
    }
    if (dueDate && !DATE_RE.test(dueDate)) {
      setError("Use YYYY-MM-DD for the due date");
      return;
    }
    setError(null);
    try {
      await onSave(todo.id, {
        title: trimmed,
        dueDate: dueDate ? dueDate : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }, [todo, title, dueDate, onSave, onClose]);

  return (
    <Modal visible={visible && !!todo} onClose={onClose} title="Edit to-do">
      <View style={styles.body} testID="todo-edit-sheet">
        <TextInput
          value={title}
          onChangeText={setTitle}
          label="Title"
          placeholder="To-do title"
          accessibilityLabel="To-do title"
          testID="todo-edit-title"
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Due date</Text>
        {Platform.OS === "web" ? (
          <View style={styles.webDateRow}>
            {/* RN DatePickerIOS removed — community picker or plain date input (Context7). */}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              data-testid="todo-edit-due"
              aria-label="Due date"
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.textPrimary,
                fontSize: 16,
              }}
            />
          </View>
        ) : (
          <TextInput
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="YYYY-MM-DD"
            accessibilityLabel="Due date"
            testID="todo-edit-due"
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}

        <Pressable
          onPress={handleClearDue}
          accessibilityRole="button"
          accessibilityLabel="Clear due date"
          testID="todo-edit-clear-due"
          style={styles.clearDue}
        >
          <Text style={[styles.clearDueText, { color: colors.textTertiary }]}>Clear due date</Text>
        </Pressable>

        {error && (
          <Text style={[styles.error, { color: colors.error }]} testID="todo-edit-error">
            {error}
          </Text>
        )}

        <View style={styles.actions}>
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button title="Save" onPress={handleSave} loading={saving} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  webDateRow: {
    width: "100%",
  },
  clearDue: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  clearDueText: {
    ...typography.caption,
  },
  error: {
    ...typography.caption,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
