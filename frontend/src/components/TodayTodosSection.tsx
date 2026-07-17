import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Animated,
} from "react-native";
import { spacing, radii, typography, lightTheme } from "../design-system";
import {
  useTodosToday,
  weekdayShortLabel,
  type TodayTodoItem,
} from "../hooks/useTodos";

type Props = {
  /** When true, always offer a quiet entry point even if the section is collapsed. */
  allowReveal?: boolean;
  onManage?: () => void;
};

export function TodayTodosSection({ allowReveal = true, onManage }: Props) {
  const colors = lightTheme;
  const {
    items,
    visible,
    forceShow,
    creating,
    showComposer,
    toggleComplete,
    quickAdd,
  } = useTodosToday();

  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!forceShow) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [forceShow]);
  const handleSubmit = useCallback(async () => {
    const title = draft;
    if (!title.trim()) return;
    setDraft("");
    try {
      await quickAdd(title);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      setDraft(title);
    }
  }, [draft, quickAdd]);

  if (!visible) {
    if (!allowReveal) return null;
    return (
      <View style={styles.revealWrap} testID="todos-reveal">
        <Pressable
          onPress={showComposer}
          accessibilityRole="button"
          accessibilityLabel="Add a to-do"
          testID="todos-reveal-button"
          hitSlop={8}
        >
          <Text style={[styles.revealText, { color: colors.textTertiary }]}>Add a to-do</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section} testID="today-todos-section">
      <View style={styles.headerRow}>
        <Text style={[styles.header, { color: colors.textSecondary }]}>To-dos</Text>
        {onManage && (
          <Pressable
            onPress={onManage}
            accessibilityRole="button"
            accessibilityLabel="Manage to-dos"
            testID="todos-manage-button"
            hitSlop={8}
          >
            <Text style={[styles.manageText, { color: colors.textTertiary }]}>Manage</Text>
          </Pressable>
        )}
      </View>

      {items.map((item) => (
        <TodoRow key={item.todo.id} item={item} onToggle={toggleComplete} />
      ))}

      <View style={[styles.quickAddRow, { borderColor: colors.border }]}>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={handleSubmit}
          placeholder="Add a to-do"
          placeholderTextColor={colors.textTertiary}
          editable={!creating}
          returnKeyType="done"
          blurOnSubmit={false}
          style={[styles.quickAddInput, { color: colors.textPrimary }]}
          accessibilityLabel="Add a to-do"
          testID="todos-quick-add"
        />
      </View>
    </View>
  );
}

type RowProps = {
  item: TodayTodoItem;
  onToggle: (id: string) => void;
};

function TodoRow({ item, onToggle }: RowProps) {
  const colors = lightTheme;
  const { todo, bucket, exiting } = item;
  const opacity = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!exiting) {
      opacity.setValue(1);
      translateX.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 280,
        delay: 160,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 24,
        duration: 280,
        delay: 160,
        useNativeDriver: true,
      }),
    ]).start();
  }, [exiting, opacity, translateX]);

  const checked = exiting || todo.completedAt != null;
  const overdueLabel =
    bucket === "overdue" && todo.dueDate
      ? `since ${weekdayShortLabel(todo.dueDate)}`
      : null;

  return (
    <Animated.View
      style={[styles.row, { opacity, transform: [{ translateX }] }]}
      testID={`todo-row-${todo.id}`}
    >
      <Pressable
        onPress={() => onToggle(todo.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={todo.title}
        hitSlop={6}
        style={styles.checkboxHit}
        testID={`todo-toggle-${todo.id}`}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: checked ? colors.success : colors.border,
              backgroundColor: checked ? colors.success : "transparent",
            },
          ]}
        >
          {checked && <Text style={styles.checkmark}>{"\u2713"}</Text>}
        </View>
      </Pressable>

      <View style={styles.rowBody}>
        <Text
          style={[
            styles.title,
            { color: colors.textPrimary },
            checked && styles.titleChecked,
          ]}
          numberOfLines={2}
        >
          {todo.title}
        </Text>
        {overdueLabel && !checked && (
          <Text
            style={[styles.overdueTag, { color: colors.textTertiary }]}
            testID={`todo-overdue-${todo.id}`}
          >
            {overdueLabel}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  revealWrap: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.base,
  },
  revealText: {
    ...typography.caption,
    fontWeight: "500",
  },
  section: {
    paddingTop: spacing.md,
    paddingBottom: spacing.base,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  header: {
    ...typography.caption,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  manageText: {
    ...typography.caption,
    fontWeight: "500",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
  },
  checkboxHit: {
    paddingTop: 2,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 12,
  },
  rowBody: {
    flex: 1,
    gap: 1,
  },
  title: {
    ...typography.bodySmall,
    fontWeight: "500",
  },
  titleChecked: {
    textDecorationLine: "line-through",
    opacity: 0.55,
  },
  overdueTag: {
    ...typography.caption,
    fontSize: 11,
  },
  quickAddRow: {
    marginTop: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
  },
  quickAddInput: {
    ...typography.bodySmall,
    paddingVertical: spacing.xs,
  },
});
