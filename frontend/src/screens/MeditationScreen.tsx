import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Vibration,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { useAudioPlayer } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { useReducedMotion, spacing, radii } from "../design-system";
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
const BREATH_MS = 4000;

// The screen is its own place — a fixed night palette, independent of app theme.
const night = {
  gradient: ["#070A1C", "#10142E", "#1D1535"] as const,
  ink: "#F5F1E8",
  inkDim: "rgba(245,241,232,0.55)",
  inkFaint: "rgba(245,241,232,0.35)",
  gold: "#F2C57C",
  goldLabel: "rgba(242,197,124,0.8)",
  ember: "#FF9E3D",
  amber: "#E89A45",
  amberInk: "#241505",
  track: "rgba(245,241,232,0.08)",
  pillBg: "rgba(245,241,232,0.06)",
  pillBorder: "rgba(245,241,232,0.16)",
  pillSelectedBg: "rgba(255,174,92,0.16)",
  scrim: "rgba(5,7,20,0.97)",
  paper: "rgba(247,243,234,0.97)",
};

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

type EmberRingProps = {
  size: number;
  /** 0..1 fraction of the session elapsed — drawn as the gold arc. */
  progress: number;
  breath: Animated.Value;
  glow: Animated.Value;
};

/** Amber ember breathing inside a thin gold progress arc. */
function EmberRing({ size, progress, breath, glow }: EmberRingProps) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const emberSize = size * 0.68;
  const coreSize = emberSize * 0.62;
  const heartSize = coreSize * 0.44;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg
        width={size}
        height={size}
        style={[StyleSheet.absoluteFill, { transform: [{ rotate: "-90deg" }] }]}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={night.track}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={night.gold}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          fill="none"
        />
      </Svg>
      <Animated.View
        style={[
          styles.ember,
          {
            width: emberSize,
            height: emberSize,
            borderRadius: emberSize / 2,
            opacity: glow,
            transform: [{ scale: breath }],
          },
        ]}
      >
        <View
          style={[
            styles.emberCore,
            { width: coreSize, height: coreSize, borderRadius: coreSize / 2 },
          ]}
        >
          <View
            style={[
              styles.emberHeart,
              { width: heartSize, height: heartSize, borderRadius: heartSize / 2 },
            ]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

export function MeditationScreen({ onClose, completionExtra }: Props) {
  const reducedMotion = useReducedMotion();
  const [durationMin, setDurationMin] = useState(DEFAULT_DURATION_MIN);
  const [session, setSession] = useState<MeditationSessionState>(() =>
    createSetupState(DEFAULT_DURATION_MIN),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [logSkipped, setLogSkipped] = useState(false);
  const breath = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(1)).current;
  const controls = useRef(new Animated.Value(0)).current;
  const player = useAudioPlayer(chimeSource);

  const chime = useCallback(() => {
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // Autoplay / missing audio — the visuals carry the moment
    }
  }, [player]);

  useEffect(() => {
    let cancelled = false;
    loadLastDurationMin().then((clamped) => {
      if (cancelled) return;
      setDurationMin(clamped);
      setSession((prev) => (prev.phase === "setup" ? createSetupState(clamped) : prev));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Repaint tick — meditationTimer's absolute endsAt stays the source of truth.
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

  // Keep the screen awake on web while running (native uses expo-keep-awake).
  useEffect(() => {
    if (Platform.OS !== "web" || session.phase !== "running") return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, [session.phase]);

  // Breathing: swell for four seconds, settle for four.
  useEffect(() => {
    if (session.phase !== "running" || reducedMotion) {
      breath.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1.1,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [session.phase, reducedMotion, breath]);

  // Glow dims while paused; controls fade in only then.
  useEffect(() => {
    const paused = session.phase === "paused";
    if (reducedMotion) {
      glow.setValue(paused ? 0.45 : 1);
      controls.setValue(paused ? 1 : 0);
      return;
    }
    Animated.timing(glow, {
      toValue: paused ? 0.45 : 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
    Animated.timing(controls, {
      toValue: paused ? 1 : 0,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [session.phase, reducedMotion, glow, controls]);

  // Completion: chime, soft haptic, one bloom of the ember.
  useEffect(() => {
    if (session.phase !== "completed") return;
    chime();
    if (Platform.OS !== "web") {
      try {
        Vibration.vibrate(400);
      } catch {
        // ignore
      }
    }
    if (!reducedMotion) {
      breath.setValue(1);
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1.18,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [session.phase, chime, reducedMotion, breath]);

  const selectDuration = useCallback((minutes: number) => {
    const clamped = clampDurationMinutes(minutes);
    setDurationMin(clamped);
    setSession(createSetupState(clamped));
  }, []);

  const handleStart = useCallback(() => {
    void saveLastDurationMin(durationMin);
    // Begin is a user gesture — playing here unlocks web audio for the end chime too.
    chime();
    if (Platform.OS !== "web") {
      try {
        Vibration.vibrate(50);
      } catch {
        // ignore
      }
    }
    const t = Date.now();
    setNowMs(t);
    setSession((prev) =>
      startSession(
        { ...prev, durationMs: durationMin * 60_000, remainingMs: durationMin * 60_000 },
        t,
      ),
    );
  }, [durationMin, chime]);

  const handleRingPress = useCallback(() => {
    const t = Date.now();
    setNowMs(t);
    setSession((prev) =>
      prev.phase === "running" ? pauseSession(prev, t) : resumeSession(prev, t),
    );
  }, []);

  const handleResume = useCallback(() => {
    const t = Date.now();
    setNowMs(t);
    setSession((prev) => resumeSession(prev, t));
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
  const progress =
    session.phase === "completed"
      ? 1
      : session.durationMs > 0
        ? 1 - remaining / session.durationMs
        : 0;
  const calmMinutes = completedMinutesLabel(session.completedMs);

  return (
    <LinearGradient
      colors={night.gradient}
      locations={[0, 0.55, 1]}
      style={styles.screen}
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
          <Text style={styles.closeGlyph}>{"✕"}</Text>
        </Pressable>
      </View>

      {session.phase === "setup" && (
        <View style={styles.setup} testID="meditation-setup">
          <Text style={styles.wordmark}>Meditation</Text>
          <Text style={styles.setupHint}>
            Settle in — there is no wrong amount of time.
          </Text>

          <View style={styles.durationRow}>
            <Pressable
              onPress={() => selectDuration(durationMin - 1)}
              disabled={durationMin <= MEDITATION_MIN_MINUTES}
              accessibilityRole="button"
              accessibilityLabel="Decrease duration"
              testID="meditation-stepper-dec"
              style={({ pressed }) => [
                styles.stepperBtn,
                durationMin <= MEDITATION_MIN_MINUTES && styles.stepperDisabled,
                pressed && styles.stepperPressed,
              ]}
            >
              <Text style={styles.stepperGlyph}>{"−"}</Text>
            </Pressable>

            <Text style={styles.durationValue} testID="meditation-duration-value">
              {durationMin}
              <Text style={styles.durationUnit}> min</Text>
            </Text>

            <Pressable
              onPress={() => selectDuration(durationMin + 1)}
              disabled={durationMin >= MEDITATION_MAX_MINUTES}
              accessibilityRole="button"
              accessibilityLabel="Increase duration"
              testID="meditation-stepper-inc"
              style={({ pressed }) => [
                styles.stepperBtn,
                durationMin >= MEDITATION_MAX_MINUTES && styles.stepperDisabled,
                pressed && styles.stepperPressed,
              ]}
            >
              <Text style={styles.stepperGlyph}>{"+"}</Text>
            </Pressable>
          </View>

          <View style={styles.presets} testID="meditation-presets">
            {MEDITATION_PRESETS_MIN.map((m) => {
              const selected = durationMin === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => selectDuration(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${m} minutes`}
                  testID={`meditation-preset-${m}`}
                  style={[styles.presetPill, selected && styles.presetPillSelected]}
                >
                  <Text style={[styles.presetText, selected && styles.presetTextSelected]}>
                    {m}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={handleStart}
            accessibilityRole="button"
            accessibilityLabel="Begin meditation"
            style={({ pressed }) => [styles.beginBtn, pressed && styles.amberPressed]}
          >
            <Text style={styles.beginText}>Begin</Text>
          </Pressable>
        </View>
      )}

      {isActive && (
        <View style={styles.session} testID="meditation-session">
          <Pressable
            onPress={handleRingPress}
            accessibilityRole="button"
            accessibilityLabel={
              session.phase === "running" ? "Pause session" : "Tap to resume"
            }
            testID="meditation-ring"
          >
            <EmberRing size={280} progress={progress} breath={breath} glow={glow} />
          </Pressable>

          <Text style={styles.clock} testID="meditation-clock" accessibilityRole="timer">
            {formatMmSs(remaining)}
          </Text>

          {session.phase === "paused" ? (
            <Animated.View style={[styles.pausedControls, { opacity: controls }]}>
              <Text style={styles.pausedLabel}>Paused</Text>
              <Pressable
                onPress={handleResume}
                accessibilityRole="button"
                accessibilityLabel="Resume session"
                style={({ pressed }) => [styles.resumeBtn, pressed && styles.amberPressed]}
              >
                <Text style={styles.resumeText}>Resume</Text>
              </Pressable>
              <Pressable
                onPress={requestClose}
                accessibilityRole="button"
                accessibilityLabel="End session early"
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostText}>End session</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <Text style={styles.sessionHint}>tap the circle to pause</Text>
          )}
        </View>
      )}

      {session.phase === "completed" && (
        <ScrollView
          style={styles.completionScroll}
          contentContainerStyle={styles.completion}
          testID="meditation-completion"
        >
          <EmberRing size={180} progress={1} breath={breath} glow={glow} />
          <Text style={styles.completionTitle}>
            {calmMinutes} {calmMinutes === 1 ? "minute" : "minutes"} of calm
          </Text>
          <Text style={styles.completionSub}>Nice work showing up for yourself.</Text>
          {!logSkipped && (
            <MeditationLogSheet
              containerStyle={styles.logCard}
              onSkip={() => setLogSkipped(true)}
            />
          )}
          {completionExtra}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={({ pressed }) => [styles.beginBtn, pressed && styles.amberPressed]}
          >
            <Text style={styles.beginText}>Done</Text>
          </Pressable>
        </ScrollView>
      )}

      {showEndConfirm && (
        <View style={styles.confirmScrim} testID="meditation-end-confirm">
          <Text style={styles.confirmTitle}>End session?</Text>
          <Text style={styles.confirmBody}>
            Every minute counts. You can begin again whenever you are ready.
          </Text>
          <Pressable
            onPress={() => setShowEndConfirm(false)}
            accessibilityRole="button"
            accessibilityLabel="Keep going"
            style={({ pressed }) => [styles.beginBtn, pressed && styles.amberPressed]}
          >
            <Text style={styles.beginText}>Keep going</Text>
          </Pressable>
          <Pressable
            onPress={confirmEndEarly}
            accessibilityRole="button"
            accessibilityLabel="Confirm end session"
            style={styles.ghostBtn}
          >
            <Text style={styles.ghostText}>End session</Text>
          </Pressable>
        </View>
      )}
    </LinearGradient>
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
    color: night.inkDim,
  },

  // --- Setup ---
  setup: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["4xl"],
    gap: spacing.xl,
  },
  wordmark: {
    fontSize: 13,
    letterSpacing: 5,
    textTransform: "uppercase",
    color: night.goldLabel,
  },
  setupHint: {
    fontSize: 15,
    color: night.inkDim,
    textAlign: "center",
    maxWidth: 360,
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  durationValue: {
    fontSize: 76,
    fontWeight: "200",
    color: night.ink,
    fontVariant: ["tabular-nums"],
    minWidth: 170,
    textAlign: "center",
  },
  durationUnit: {
    fontSize: 18,
    fontWeight: "400",
    color: night.inkDim,
    letterSpacing: 1,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: night.pillBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperPressed: {
    backgroundColor: night.pillBg,
  },
  stepperDisabled: {
    opacity: 0.3,
  },
  stepperGlyph: {
    fontSize: 22,
    color: night.inkDim,
  },
  presets: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  presetPill: {
    minWidth: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: night.pillBorder,
    backgroundColor: night.pillBg,
    alignItems: "center",
  },
  presetPillSelected: {
    backgroundColor: night.pillSelectedBg,
    borderColor: night.amber,
  },
  presetText: {
    fontSize: 15,
    fontWeight: "600",
    color: night.inkDim,
  },
  presetTextSelected: {
    color: night.gold,
  },
  beginBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing["4xl"],
    paddingVertical: 14,
    borderRadius: radii.full,
    backgroundColor: night.amber,
    shadowColor: night.ember,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
  },
  amberPressed: {
    opacity: 0.85,
  },
  beginText: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: night.amberInk,
  },

  // --- Session ---
  session: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing["2xl"],
  },
  ember: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,166,80,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,190,120,0.4)",
    shadowColor: night.ember,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 48,
  },
  emberCore: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,176,92,0.14)",
  },
  emberHeart: {
    backgroundColor: "rgba(255,196,128,0.35)",
    shadowColor: "#FFB65C",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
  },
  clock: {
    fontSize: 58,
    fontWeight: "200",
    letterSpacing: 3,
    color: "rgba(245,241,232,0.92)",
    fontVariant: ["tabular-nums"],
  },
  sessionHint: {
    fontSize: 13,
    letterSpacing: 1.5,
    color: night.inkFaint,
  },
  pausedControls: {
    alignItems: "center",
    gap: spacing.base,
  },
  pausedLabel: {
    fontSize: 13,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: night.inkDim,
  },
  resumeBtn: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    borderRadius: radii.full,
    backgroundColor: night.amber,
  },
  resumeText: {
    fontSize: 16,
    fontWeight: "700",
    color: night.amberInk,
  },
  ghostBtn: {
    padding: spacing.sm,
  },
  ghostText: {
    fontSize: 15,
    color: night.inkDim,
  },

  // --- Completion ---
  completionScroll: {
    flex: 1,
  },
  completion: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing.xl,
  },
  completionTitle: {
    fontSize: 28,
    fontWeight: "300",
    color: night.ink,
    textAlign: "center",
  },
  completionSub: {
    fontSize: 15,
    color: night.inkDim,
    textAlign: "center",
  },
  logCard: {
    maxWidth: 400,
    backgroundColor: night.paper,
    borderRadius: radii["2xl"],
    padding: spacing.lg,
  },

  // --- End-early confirm ---
  confirmScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: night.scrim,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.base,
  },
  confirmTitle: {
    fontSize: 24,
    fontWeight: "300",
    color: night.ink,
  },
  confirmBody: {
    fontSize: 15,
    color: night.inkDim,
    textAlign: "center",
    maxWidth: 300,
    marginBottom: spacing.md,
  },
});
