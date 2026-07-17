import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Button, spacing, radii, typography, lightTheme } from "../design-system";
import { useTodayHabits } from "../hooks/useTodayHabits";
import { suggestHabitId } from "../utils/meditationLogSuggest";
import {
  loadLastLoggedHabitId,
  saveLastLoggedHabitId,
} from "../utils/meditationPrefs";

type Props = {
  onLogged?: () => void;
  onSkip?: () => void;
  /** Styles the root container — nothing renders (not even this) when there are no habits. */
  containerStyle?: StyleProp<ViewStyle>;
};

export function MeditationLogSheet({ onLogged, onSkip, containerStyle }: Props) {
  const colors = lightTheme;
  const { items, loading, toggleCompletion, completing, today } = useTodayHabits();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastLoggedId, setLastLoggedId] = useState<string | null | undefined>(undefined);
  const [logging, setLogging] = useState(false);
  const [loggedId, setLoggedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLastLoggedHabitId().then((id) => {
      if (!cancelled) setLastLoggedId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lastLoggedId === undefined) return;
    setSelectedId(
      suggestHabitId(
        items.map((i) => ({ id: i.habit.id, name: i.habit.name })),
        lastLoggedId,
      ),
    );
  }, [items, lastLoggedId]);

  const handleLog = useCallback(async () => {
    if (!selectedId || logging) return;
    const item = items.find((i) => i.habit.id === selectedId);
    if (!item || item.completedToday) return;

    setLogging(true);
    try {
      await toggleCompletion(selectedId, "full");
      await saveLastLoggedHabitId(selectedId);
      setLoggedId(selectedId);
      onLogged?.();
    } finally {
      setLogging(false);
    }
  }, [selectedId, logging, items, toggleCompletion, onLogged]);

  if (loading && items.length === 0) {
    return null;
  }

  if (items.length === 0) {
    return null;
  }

  if (lastLoggedId === undefined) {
    return null;
  }

  return (
    <View style={[styles.sheet, containerStyle]} testID="meditation-log-sheet">
      <Text style={[styles.title, { color: colors.textPrimary }]}>Log to habit</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Optional — only if you want this session on your flame.
      </Text>

      <View style={styles.list} testID="meditation-log-habits">
        {items.map((item) => {
          const id = item.habit.id;
          const done = item.completedToday || loggedId === id;
          const selected = selectedId === id;
          const busy = completing.has(`${id}:${today}`);

          return (
            <Pressable
              key={id}
              onPress={() => {
                if (done) return;
                setSelectedId(id);
              }}
              disabled={done || busy}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: done }}
              accessibilityLabel={
                done
                  ? `${item.habit.name}, already done today`
                  : `Log to ${item.habit.name}`
              }
              testID={`meditation-log-habit-${id}`}
              style={[
                styles.row,
                {
                  borderColor: selected && !done ? colors.brandPrimary : colors.border,
                  opacity: done ? 0.55 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.icon,
                  { backgroundColor: item.habit.color ?? colors.brandMuted },
                ]}
              >
                <Text style={styles.iconText}>{item.habit.icon ?? "\u2B50"}</Text>
              </View>
              <Text
                style={[styles.name, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {item.habit.name}
              </Text>
              {done ? (
                <Text
                  style={[styles.doneMark, { color: colors.success }]}
                  testID={`meditation-log-done-${id}`}
                >
                  {"\u2713"}
                </Text>
              ) : selected ? (
                <Text style={{ color: colors.brandPrimary }}>{"\u25CF"}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Button
          title="Not now"
          onPress={() => onSkip?.()}
          variant="ghost"
          size="md"
          accessibilityLabel="Not now"
        />
        <Button
          title={logging ? "Logging…" : "Log"}
          onPress={handleLog}
          variant="primary"
          size="md"
          disabled={!selectedId || logging || !!items.find((i) => i.habit.id === selectedId)?.completedToday}
          accessibilityLabel="Log session to habit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    width: "100%",
    maxWidth: 360,
    gap: spacing.md,
    alignItems: "stretch",
  },
  title: {
    ...typography.body,
    fontWeight: "700",
    textAlign: "center",
  },
  hint: {
    ...typography.caption,
    textAlign: "center",
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 16,
  },
  name: {
    ...typography.bodySmall,
    fontWeight: "600",
    flex: 1,
  },
  doneMark: {
    fontSize: 16,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
