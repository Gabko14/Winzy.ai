import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Vibration,
  Animated,
} from "react-native";
import { useAudioPlayer } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import {
  Button,
  Modal,
  useReducedMotion,
  spacing,
  radii,
  typography,
  lightTheme,
} from "../design-system";
import {
  MEDITATION_PRESETS_MIN,
  MEDITATION_MIN_MINUTES,
  MEDITATION_MAX_MINUTES,
  clampDurationMinutes,
  createSetupState,
  startSession,
  pauseSession,
  resumeSession,
  remainingMsAt,
  syncSession,
  formatMmSs,
  completedMinutesLabel,
  type MeditationSessionState,
} from "../utils/meditationTimer";
import {
  DEFAULT_DURATION_MIN,
  loadLastDurationMin,
  saveLastDurationMin,
  _resetMeditationStorage,
} from "../utils/meditationPrefs";
import { MeditationLogSheet } from "../components/MeditationLogSheet";
import chimeSource from "../../assets/sounds/meditation-chime.wav";

const TICK_MS = 500;

export { _resetMeditationStorage };

type Props = {
  onClose: () => void;
  /** Optional slot below the log sheet (kept for extensibility). */
  completionExtra?: React.ReactNode;
};

function KeepAwakeNative() {
  useKeepAwake();
  return null;
}

export function MeditationScreen({ onClose, completionExtra }: Props) {
  const colors = lightTheme;
  const reducedMotion = useReducedMotion();
  const [durationMin, setDurationMin] = useState(DEFAULT_DURATION_MIN);
  const [session, setSession] = useState<MeditationSessionState>(() =>
    createSetupState(DEFAULT_DURATION_MIN),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [bloom, setBloom] = useState(false);
  const [logSkipped, setLogSkipped] = useState(false);
  const breath = useRef(new Animated.Value(1)).current;
  const player = useAudioPlayer(chimeSource);

  useEffect(() => {
    let cancelled = false;
    loadLastDurationMin().then((clamped) => {
      if (cancelled) return;
      setDurationMin(clamped);
      setSession((prev) =>
        prev.phase === "setup" ? createSetupState(clamped) : prev,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session.phase !== "running") return;
    const id = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      setSession((prev) => syncSession(prev, t));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [session.phase]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const t = Date.now();
      setNowMs(t);
      setSession((prev) => syncSession(prev, t));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (session.phase !== "running" || reducedMotion) {
      breath.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1.06,
          duration: 3200,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: 3200,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [session.phase, reducedMotion, breath]);

  useEffect(() => {
    if (session.phase !== "completed") return;
    setBloom(true);
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // Autoplay / missing audio — visual is the signal
    }
    if (Platform.OS !== "web") {
      try {
        Vibration.vibrate(400);
      } catch {
        // ignore
      }
    }
  }, [session.phase, player]);

  const persistDuration = useCallback((minutes: number) => {
    void saveLastDurationMin(minutes);
  }, []);

  const selectDuration = useCallback(
    (minutes: number) => {
      const clamped = clampDurationMinutes(minutes);
      setDurationMin(clamped);
      setSession(createSetupState(clamped));
    },
    [],
  );

  const handleStart = useCallback(() => {
    persistDuration(durationMin);
    const t = Date.now();
    setNowMs(t);
    setSession((prev) => startSession({ ...prev, durationMs: durationMin * 60_000, remainingMs: durationMin * 60_000 }, t));
  }, [durationMin, persistDuration]);

  const handlePauseResume = useCallback(() => {
    const t = Date.now();
    setNowMs(t);
    setSession((prev) =>
      prev.phase === "running" ? pauseSession(prev, t) : resumeSession(prev, t),
    );
  }, []);

  const requestClose = useCallback(() => {
    if (session.phase === "running" || session.phase === "paused") {
      setShowEndConfirm(true);
      return;
    }
    onClose();
  }, [session.phase, onClose]);

  const confirmEndEarly = useCallback(() => {
    setShowEndConfirm(false);
    onClose();
  }, [onClose]);

  const remaining = remainingMsAt(session, nowMs);
  const isActive = session.phase === "running" || session.phase === "paused";

  return (
    <View
      style={[styles.screen, { backgroundColor: colors.background }]}
      testID="meditation-screen"
    >
      {session.phase === "running" && Platform.OS !== "web" ? <KeepAwakeNative /> : null}

      <View style={styles.topBar}>
        <Pressable
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel={isActive ? "End session" : "Close"}
          testID="meditation-close"
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Text style={[styles.closeGlyph, { color: colors.textSecondary }]}>{"\u2715"}</Text>
        </Pressable>
      </View>

      {session.phase === "setup" && (
        <View style={styles.setup} testID="meditation-setup">
          <Text style={[styles.title, { color: colors.textPrimary }]}>Meditation</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Choose a length that feels right. There is no wrong amount.
          </Text>

          <View style={styles.presets} testID="meditation-presets">
            {MEDITATION_PRESETS_MIN.map((m) => {
              const selected = durationMin === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => selectDuration(m)}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: selected ? colors.brandPrimary : colors.surface,
                      borderColor: selected ? colors.brandPrimary : colors.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${m} minutes`}
                  testID={`meditation-preset-${m}`}
                >
                  <Text
                    style={[
                      styles.presetText,
                      { color: selected ? "#FFFFFF" : colors.textPrimary },
                    ]}
                  >
                    {m} min
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.stepper} testID="meditation-stepper">
            <Pressable
              onPress={() => selectDuration(durationMin - 1)}
              disabled={durationMin <= MEDITATION_MIN_MINUTES}
              accessibilityRole="button"
              accessibilityLabel="Decrease duration"
              testID="meditation-stepper-dec"
              style={styles.stepperBtn}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 22 }}>{"\u2212"}</Text>
            </Pressable>
            <Text
              style={[styles.stepperValue, { color: colors.textPrimary }]}
              testID="meditation-duration-value"
            >
              {durationMin} min
            </Text>
            <Pressable
              onPress={() => selectDuration(durationMin + 1)}
              disabled={durationMin >= MEDITATION_MAX_MINUTES}
              accessibilityRole="button"
              accessibilityLabel="Increase duration"
              testID="meditation-stepper-inc"
              style={styles.stepperBtn}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 22 }}>{"\u002B"}</Text>
            </Pressable>
          </View>

          <Button
            title="Begin"
            onPress={handleStart}
            variant="primary"
            size="lg"
            accessibilityLabel="Begin meditation"
          />
        </View>
      )}

      {isActive && (
        <View style={styles.session} testID="meditation-session">
          <Animated.View
            style={[
              styles.breathRing,
              {
                borderColor: colors.brandMuted,
                transform: [{ scale: breath }],
                opacity: bloom ? 0.3 : 0.55,
              },
            ]}
            testID="meditation-breath"
          />
          <Text
            style={[styles.clock, { color: colors.textPrimary }]}
            testID="meditation-clock"
            accessibilityRole="timer"
          >
            {formatMmSs(remaining)}
          </Text>
          <Text style={[styles.sessionHint, { color: colors.textTertiary }]}>
            {session.phase === "paused" ? "Paused" : "Breathe"}
          </Text>
          <Button
            title={session.phase === "paused" ? "Resume" : "Pause"}
            onPress={handlePauseResume}
            variant="secondary"
            size="md"
            accessibilityLabel={session.phase === "paused" ? "Resume session" : "Pause session"}
          />
        </View>
      )}

      {session.phase === "completed" && (
        <View
          style={[styles.completion, bloom && styles.bloom]}
          testID="meditation-completion"
        >
          <Text style={[styles.completionTitle, { color: colors.textPrimary }]}>
            {completedMinutesLabel(session.completedMs)}{" "}
            {completedMinutesLabel(session.completedMs) === 1 ? "minute" : "minutes"} of calm
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Nice work showing up for yourself.
          </Text>
          {!logSkipped && (
            <MeditationLogSheet onSkip={() => setLogSkipped(true)} />
          )}
          {completionExtra}
          <Button
            title="Done"
            onPress={onClose}
            variant="primary"
            size="lg"
            accessibilityLabel="Done"
          />
        </View>
      )}

      <Modal
        visible={showEndConfirm}
        onClose={() => setShowEndConfirm(false)}
        title="End session?"
      >
        <Text style={[styles.confirmBody, { color: colors.textSecondary }]}>
          Every minute counts. You can always begin again when you are ready.
        </Text>
        <View style={styles.confirmActions}>
          <Button
            title="Keep going"
            onPress={() => setShowEndConfirm(false)}
            variant="secondary"
            size="md"
          />
          <Button
            title="End session"
            onPress={confirmEndEarly}
            variant="primary"
            size="md"
            accessibilityLabel="Confirm end session"
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
  },
  closeBtn: {
    padding: spacing.sm,
  },
  closeGlyph: {
    fontSize: 20,
  },
  setup: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["2xl"],
    gap: spacing.xl,
    alignItems: "center",
  },
  title: {
    ...typography.h2,
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
    maxWidth: 320,
  },
  presets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
  },
  presetChip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  presetText: {
    ...typography.bodySmall,
    fontWeight: "600",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    ...typography.h3,
    minWidth: 88,
    textAlign: "center",
  },
  session: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  breathRing: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
  },
  clock: {
    fontSize: 64,
    fontWeight: "300",
    letterSpacing: 2,
    fontVariant: ["tabular-nums"],
  },
  sessionHint: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  completion: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  bloom: {
    // Soft visual bloom via extra vertical rhythm; color stays calm
  },
  completionTitle: {
    ...typography.h2,
    textAlign: "center",
  },
  confirmBody: {
    ...typography.body,
    marginBottom: spacing.xl,
  },
  confirmActions: {
    flexDirection: "row",
    gap: spacing.md,
  },
});
