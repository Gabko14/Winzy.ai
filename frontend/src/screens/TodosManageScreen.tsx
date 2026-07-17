import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import {
  ScreenHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  InlineError,
  spacing,
  typography,
  lightTheme,
} from "../design-system";
import { TodoEditSheet } from "../components/TodoEditSheet";
import { useTodosManage, weekdayShortLabel } from "../hooks/useTodos";
import { isApiError } from "../api";
import type { Todo } from "../api/todos";

type Props = {
  onBack: () => void;
};

export function TodosManageScreen({ onBack }: Props) {
  const colors = lightTheme;
  const {
    openTodos,
    completedTodos,
    loading,
    error,
    updating,
    update,
    remove,
    uncomplete,
    orderTodos,
    refresh,
  } = useTodosManage();

  const [reorderMode, setReorderMode] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [committingOrder, setCommittingOrder] = useState(false);

  const displayOpen = useMemo(() => {
    if (!reorderMode) return openTodos;
    const byId = new Map(openTodos.map((t) => [t.id, t]));
    return draftIds.map((id) => byId.get(id)).filter((t): t is Todo => !!t);
  }, [reorderMode, openTodos, draftIds]);

  const enterReorder = useCallback(() => {
    setDraftIds(openTodos.map((t) => t.id));
    setOrderError(null);
    setReorderMode(true);
  }, [openTodos]);

  const cancelReorder = useCallback(() => {
    setReorderMode(false);
    setDraftIds([]);
    setOrderError(null);
  }, []);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setDraftIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[nextIdx];
      next[nextIdx] = tmp;
      return next;
    });
  }, []);

  const commitReorder = useCallback(async () => {
    setCommittingOrder(true);
    setOrderError(null);
    try {
      await orderTodos(draftIds);
      setReorderMode(false);
      setDraftIds([]);
    } catch (err) {
      const message = isApiError(err)
        ? err.message
        : "Could not save order. The list was refreshed.";
      setOrderError(message);
      await refresh();
      setReorderMode(false);
      setDraftIds([]);
    } finally {
      setCommittingOrder(false);
    }
  }, [draftIds, orderTodos, refresh]);

  const confirmDelete = useCallback(
    (todo: Todo) => {
      const doDelete = async () => {
        try {
          await remove(todo.id);
        } catch {
          // Hook restores cache
        }
      };
      if (Platform.OS === "web") {
        if (window.confirm(`Delete "${todo.title}"? This cannot be undone.`)) {
          void doDelete();
        }
      } else {
        Alert.alert("Delete to-do", `Delete "${todo.title}"? This cannot be undone.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void doDelete() },
        ]);
      }
    },
    [remove],
  );

  const handleSaveEdit = useCallback(
    async (id: string, patch: { title: string; dueDate: string | null }) => {
      await update(id, { title: patch.title, dueDate: patch.dueDate });
    },
    [update],
  );

  if (loading && openTodos.length === 0 && completedTodos.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="todos-manage-loading">
        <LoadingState message="Loading to-dos..." />
      </View>
    );
  }

  if (error && openTodos.length === 0 && completedTodos.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="todos-manage-error">
        <ErrorState message={error.message} onRetry={refresh} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="todos-manage-screen">
      <ScreenHeader
        title="To-dos"
        onBack={onBack}
        right={
          reorderMode ? (
            <View style={styles.headerActions}>
              <Pressable onPress={cancelReorder} testID="todos-reorder-cancel" hitSlop={8}>
                <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitReorder}
                disabled={committingOrder}
                testID="todos-reorder-done"
                hitSlop={8}
              >
                <Text style={[styles.headerAction, { color: colors.brandPrimary }]}>
                  {committingOrder ? "Saving…" : "Done"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={enterReorder}
              disabled={openTodos.length < 2}
              accessibilityRole="button"
              accessibilityLabel="Reorder to-dos"
              testID="todos-reorder-toggle"
              hitSlop={8}
            >
              <Text
                style={[
                  styles.headerAction,
                  {
                    color: openTodos.length < 2 ? colors.textTertiary : colors.textSecondary,
                  },
                ]}
              >
                Reorder
              </Text>
            </Pressable>
          )
        }
      />

      {orderError && (
        <View style={styles.banner} testID="todos-order-error">
          <InlineError message={orderError} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list} testID="todos-manage-list">
        {displayOpen.length === 0 ? (
          <EmptyState
            title="No open to-dos"
            message="Add one from Today, or restore something from Completed below."
          />
        ) : (
          displayOpen.map((todo, index) => (
            <View
              key={todo.id}
              style={[styles.row, { borderBottomColor: colors.border }]}
              testID={`todos-manage-open-${todo.id}`}
            >
              {reorderMode ? (
                <View style={styles.reorderControls}>
                  <Pressable
                    onPress={() => move(todo.id, -1)}
                    disabled={index === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${todo.title} up`}
                    testID={`todos-move-up-${todo.id}`}
                    style={styles.chevronBtn}
                  >
                    <Text style={{ color: index === 0 ? colors.textTertiary : colors.textPrimary }}>
                      {"\u25B2"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => move(todo.id, 1)}
                    disabled={index === displayOpen.length - 1}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${todo.title} down`}
                    testID={`todos-move-down-${todo.id}`}
                    style={styles.chevronBtn}
                  >
                    <Text
                      style={{
                        color:
                          index === displayOpen.length - 1
                            ? colors.textTertiary
                            : colors.textPrimary,
                      }}
                    >
                      {"\u25BC"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable
                style={styles.rowBody}
                onPress={() => {
                  if (reorderMode) return;
                  setEditing(todo);
                }}
                onLongPress={() => {
                  if (reorderMode) return;
                  confirmDelete(todo);
                }}
                disabled={reorderMode}
                accessibilityRole="button"
                accessibilityLabel={todo.title}
                accessibilityHint="Long press to delete"
              >
                <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
                  {todo.title}
                </Text>
                {todo.dueDate && (
                  <Text style={[styles.meta, { color: colors.textTertiary }]}>
                    Due {weekdayShortLabel(todo.dueDate)}
                  </Text>
                )}
              </Pressable>

              {!reorderMode && (
                <Pressable
                  onPress={() => confirmDelete(todo)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${todo.title}`}
                  testID={`todos-delete-${todo.id}`}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Text style={[styles.deleteText, { color: colors.textTertiary }]}>Delete</Text>
                </Pressable>
              )}
            </View>
          ))
        )}

        <Pressable
          style={styles.completedHeader}
          onPress={() => setCompletedOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: completedOpen }}
          testID="todos-completed-toggle"
        >
          <Text style={[styles.completedHeaderText, { color: colors.textSecondary }]}>
            {completedOpen ? "▾" : "▸"} Completed ({completedTodos.length})
          </Text>
        </Pressable>

        {completedOpen &&
          completedTodos.map((todo) => (
            <Pressable
              key={todo.id}
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() => void uncomplete(todo.id)}
              accessibilityRole="button"
              accessibilityLabel={`Uncomplete ${todo.title}`}
              testID={`todos-manage-completed-${todo.id}`}
            >
              <View style={styles.rowBody}>
                <Text
                  style={[styles.title, styles.completedTitle, { color: colors.textSecondary }]}
                  numberOfLines={2}
                >
                  {todo.title}
                </Text>
              </View>
            </Pressable>
          ))}
      </ScrollView>

      <TodoEditSheet
        todo={editing}
        visible={!!editing}
        saving={updating}
        onClose={() => setEditing(null)}
        onSave={handleSaveEdit}
      />
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
  headerActions: {
    flexDirection: "row",
    gap: spacing.base,
    alignItems: "center",
  },
  headerAction: {
    ...typography.bodySmall,
    fontWeight: "600",
  },
  banner: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  reorderControls: {
    gap: 2,
  },
  chevronBtn: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodySmall,
    fontWeight: "500",
  },
  completedTitle: {
    textDecorationLine: "line-through",
  },
  meta: {
    ...typography.caption,
    fontSize: 11,
  },
  deleteBtn: {
    padding: spacing.xs,
  },
  deleteText: {
    ...typography.caption,
  },
  completedHeader: {
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
  },
  completedHeaderText: {
    ...typography.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
});
