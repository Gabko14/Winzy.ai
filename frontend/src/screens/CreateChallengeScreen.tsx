import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  Button,
  Card,
  TextInput,
  Flame,
  LoadingState,
  ErrorState,
  AnimatedCheckmark,
  FadeIn,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import type { FriendHabit } from "../api/social";
import { fetchFriendProfile } from "../api/social";
import { createChallenge } from "../api/challenges";
import type { CreateChallengeRequest } from "../api/challenges";
import type { ApiError } from "../api/types";
import { isApiError } from "../api/types";

// --- Constants ---

const MIN_TARGET = 1;
const MAX_TARGET = 100;
const MIN_PERIOD = 7;
const MAX_PERIOD = 365;
const DEFAULT_TARGET = 60;
const DEFAULT_PERIOD = 30;
const MAX_REWARD_LENGTH = 512;

const PERIOD_PRESETS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
] as const;

type Step = 1 | 2 | 3 | 4 | 5;

type Props = {
  friendId: string;
  friendName?: string;
  /** Pre-selected habit ID when launched from a specific habit context */
  preSelectedHabitId?: string;
  onBack?: () => void;
  onComplete?: () => void;
};

export function CreateChallengeScreen({
  friendId,
  friendName,
  preSelectedHabitId,
  onBack,
  onComplete,
}: Props) {
  const colors = lightTheme;

  // --- Data loading ---
  const [habits, setHabits] = useState<FriendHabit[]>([]);
  const [loadingHabits, setLoadingHabits] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  // --- Step state ---
  const [step, setStep] = useState<Step>(1);
  const [selectedHabit, setSelectedHabit] = useState<FriendHabit | null>(null);
  const [targetValue, setTargetValue] = useState(DEFAULT_TARGET);
  const [periodDays, setPeriodDays] = useState(DEFAULT_PERIOD);
  const [rewardDescription, setRewardDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const displayName = friendName ?? `User ${friendId.slice(0, 8)}`;

  // --- Load friend's habits ---
  const loadHabits = useCallback(async () => {
    setLoadingHabits(true);
    setLoadError(null);
    try {
      const profile = await fetchFriendProfile(friendId);
      setHabits(profile.habits);
      // Auto-select if pre-selected or single habit
      if (preSelectedHabitId) {
        const match = profile.habits.find((h) => h.id === preSelectedHabitId);
        if (match) setSelectedHabit(match);
      } else if (profile.habits.length === 1) {
        setSelectedHabit(profile.habits[0]);
      }
    } catch (err) {
      setLoadError(err as ApiError);
    } finally {
      setLoadingHabits(false);
    }
  }, [friendId, preSelectedHabitId]);

  // Load on mount
  React.useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  // --- Navigation helpers ---
  const goNext = useCallback(() => {
    setStep((s) => Math.min(s + 1, 5) as Step);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const goBack = useCallback(() => {
    if (step === 1) {
      onBack?.();
    } else {
      setStep((s) => (s - 1) as Step);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [step, onBack]);

  // --- Validation ---
  const rewardTrimmed = rewardDescription.trim();
  const rewardTooLong = rewardTrimmed.length > MAX_REWARD_LENGTH;
  const rewardEmpty = rewardTrimmed.length === 0;

  const canProceedFromStep1 = selectedHabit !== null;
  const canProceedFromStep2 = targetValue >= MIN_TARGET && targetValue <= MAX_TARGET && periodDays >= MIN_PERIOD && periodDays <= MAX_PERIOD;
  const canProceedFromStep3 = !rewardEmpty && !rewardTooLong;

  // --- Submit ---
  const handleSubmit = useCallback(async () => {
    if (!selectedHabit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const request: CreateChallengeRequest = {
        habitId: selectedHabit.id,
        recipientId: friendId,
        milestoneType: "consistencyTarget",
        targetValue,
        periodDays,
        rewardDescription: rewardTrimmed,
      };
      await createChallenge(request);
      setStep(5);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (err) {
      setSubmitError(isApiError(err) ? err : { status: 0, code: "unknown", message: "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }, [selectedHabit, friendId, targetValue, periodDays, rewardTrimmed]);

  // --- Error message for submit failures ---
  const submitErrorMessage = useMemo(() => {
    if (!submitError) return null;
    if (submitError.code === "conflict") {
      return `There's already an active challenge for this habit with ${displayName}. Complete or cancel it first!`;
    }
    if (submitError.status === 503) {
      return "A service is temporarily unavailable. Please try again in a moment.";
    }
    if (submitError.code === "validation" && submitError.validationErrors) {
      const messages = Object.values(submitError.validationErrors).flat();
      return messages.join(". ") || submitError.message;
    }
    return submitError.message;
  }, [submitError, displayName]);

  // --- Loading state ---
  if (loadingHabits && habits.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="create-challenge-loading">
        <Header step={step} totalSteps={4} onBack={onBack} title="Set Challenge" />
        <View style={styles.center}>
          <LoadingState message={`Loading ${displayName}'s habits...`} />
        </View>
      </View>
    );
  }

  // --- Load error ---
  if (loadError && habits.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="create-challenge-error">
        <Header step={step} totalSteps={4} onBack={onBack} title="Set Challenge" />
        <View style={styles.center}>
          <ErrorState message={loadError.message} onRetry={loadHabits} />
        </View>
      </View>
    );
  }

  // --- Step 5: Success ---
  if (step === 5) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="create-challenge-success">
        <View style={styles.successContainer}>
          <FadeIn>
            <View style={styles.successContent}>
              <AnimatedCheckmark visible size={64} />
              <Text style={[styles.successTitle, { color: colors.textPrimary }]}>
                Challenge sent!
              </Text>
              <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
                {displayName} will see your challenge. You're building something great together!
              </Text>
              <View style={styles.successAction}>
                <Button
                  title="Done"
                  onPress={() => { if (onComplete) { onComplete(); } else { onBack?.(); } }}
                  variant="primary"
                  size="lg"
                  accessibilityLabel="Done, return to previous screen"
                />
              </View>
            </View>
          </FadeIn>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="create-challenge-screen">
      <Header step={step} totalSteps={4} onBack={goBack} title="Set Challenge" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          testID="create-challenge-scroll"
        >
          {/* Step 1: Select habit */}
          {step === 1 && (
            <View testID="step-1-select-habit">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                Choose a habit to challenge
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                Pick one of {displayName}'s shared habits for your challenge.
              </Text>

              {habits.length === 0 ? (
                <View style={styles.emptyHabits} testID="no-habits-available">
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {displayName} hasn't shared any habits yet. Check back later!
                  </Text>
                </View>
              ) : (
                <View style={styles.habitList}>
                  {habits.map((habit) => (
                    <HabitOption
                      key={habit.id}
                      habit={habit}
                      selected={selectedHabit?.id === habit.id}
                      onSelect={() => setSelectedHabit(habit)}
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Step 2: Set target */}
          {step === 2 && selectedHabit && (
            <View testID="step-2-set-target">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                Set the consistency goal
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                What consistency should {displayName} aim for on "{selectedHabit.name}"?
                Focus on achievable progress, not perfection.
              </Text>

              {/* Target value */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
                  Target consistency
                </Text>
                <View style={styles.sliderRow}>
                  <Pressable
                    onPress={() => setTargetValue((v) => Math.max(MIN_TARGET, v - 5))}
                    style={[styles.sliderButton, { borderColor: colors.border }]}
                    accessibilityLabel={`Decrease target, currently ${targetValue}%`}
                    testID="target-decrease"
                  >
                    <Text style={[styles.sliderButtonText, { color: colors.textPrimary }]}>-</Text>
                  </Pressable>
                  <View style={styles.sliderValue}>
                    <Text style={[styles.targetValueText, { color: colors.brandPrimary }]} testID="target-value">
                      {targetValue}%
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setTargetValue((v) => Math.min(MAX_TARGET, v + 5))}
                    style={[styles.sliderButton, { borderColor: colors.border }]}
                    accessibilityLabel={`Increase target, currently ${targetValue}%`}
                    testID="target-increase"
                  >
                    <Text style={[styles.sliderButtonText, { color: colors.textPrimary }]}>+</Text>
                  </Pressable>
                </View>
                <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
                  {targetValue <= 30
                    ? "A gentle start - great for building momentum!"
                    : targetValue <= 60
                      ? "A solid goal - challenging but achievable!"
                      : targetValue <= 80
                        ? "Ambitious! This will take real commitment."
                        : "Going for the top - impressive dedication!"}
                </Text>
              </View>

              {/* Period */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
                  Time period
                </Text>
                <View style={styles.presetRow} testID="period-presets">
                  {PERIOD_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.days}
                      onPress={() => setPeriodDays(preset.days)}
                      style={[
                        styles.presetChip,
                        {
                          backgroundColor: periodDays === preset.days ? colors.brandPrimary : colors.surface,
                          borderColor: periodDays === preset.days ? colors.brandPrimary : colors.border,
                        },
                      ]}
                      accessibilityLabel={`${preset.label} period`}
                      accessibilityState={{ selected: periodDays === preset.days }}
                      testID={`period-${preset.days}`}
                    >
                      <Text
                        style={[
                          styles.presetChipText,
                          {
                            color: periodDays === preset.days ? colors.textInverse : colors.textPrimary,
                          },
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          )}

          {/* Step 3: Reward */}
          {step === 3 && (
            <View testID="step-3-reward">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                What will you do together?
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                When {displayName} hits the goal, what shared experience will you enjoy?
                Think of something you'll both love doing together.
              </Text>

              <View style={styles.fieldGroup}>
                <TextInput
                  label="Shared experience"
                  placeholder={'e.g., "We\'ll go hiking at our favorite trail"'}
                  value={rewardDescription}
                  onChangeText={setRewardDescription}
                  multiline
                  numberOfLines={3}
                  maxLength={MAX_REWARD_LENGTH}
                  validationState={rewardTooLong ? "error" : "default"}
                  errorMessage={rewardTooLong ? `Maximum ${MAX_REWARD_LENGTH} characters` : undefined}
                  hint={`${rewardTrimmed.length}/${MAX_REWARD_LENGTH} characters`}
                  testID="reward-input"
                  accessibilityLabel="Describe the shared experience reward"
                />
              </View>

              <View style={styles.rewardExamples}>
                <Text style={[styles.examplesLabel, { color: colors.textTertiary }]}>
                  IDEAS
                </Text>
                {["Grab coffee at that new place downtown", "Play a round of tennis together", "Cook dinner together and try a new recipe", "Go for a sunset bike ride"].map((example) => (
                  <Pressable
                    key={example}
                    onPress={() => setRewardDescription(example)}
                    style={[styles.exampleChip, { backgroundColor: colors.backgroundSecondary }]}
                    accessibilityLabel={`Use suggestion: ${example}`}
                  >
                    <Text style={[styles.exampleText, { color: colors.textSecondary }]}>
                      {example}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Step 4: Preview */}
          {step === 4 && selectedHabit && (
            <View testID="step-4-preview">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                Review your challenge
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                Make sure everything looks right before sending.
              </Text>

              <Card style={{ ...styles.previewCard, ...shadows.md }}>
                <View style={styles.previewSection}>
                  <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>FRIEND</Text>
                  <Text style={[styles.previewValue, { color: colors.textPrimary }]} testID="preview-friend">
                    {displayName}
                  </Text>
                </View>

                <View style={[styles.previewDivider, { backgroundColor: colors.border }]} />

                <View style={styles.previewSection}>
                  <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>HABIT</Text>
                  <View style={styles.previewHabitRow}>
                    <Flame flameLevel={selectedHabit.flameLevel} size="sm" consistency={selectedHabit.consistency} />
                    <Text style={[styles.previewValue, { color: colors.textPrimary }]} testID="preview-habit">
                      {selectedHabit.icon ? `${selectedHabit.icon} ` : ""}{selectedHabit.name}
                    </Text>
                  </View>
                </View>

                <View style={[styles.previewDivider, { backgroundColor: colors.border }]} />

                <View style={styles.previewSection}>
                  <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>GOAL</Text>
                  <Text style={[styles.previewValue, { color: colors.textPrimary }]} testID="preview-target">
                    {targetValue}% consistency over {periodDays} days
                  </Text>
                </View>

                <View style={[styles.previewDivider, { backgroundColor: colors.border }]} />

                <View style={styles.previewSection}>
                  <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>REWARD</Text>
                  <Text style={[styles.previewValue, { color: colors.textPrimary }]} testID="preview-reward">
                    {rewardTrimmed}
                  </Text>
                </View>
              </Card>

              {submitError && (
                <View style={[styles.errorBanner, { backgroundColor: colors.errorBackground }]} testID="submit-error">
                  <Text style={[styles.errorText, { color: colors.error }]}>
                    {submitErrorMessage}
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Bottom action bar */}
        {step < 5 && (
          <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]} testID="bottom-bar">
            {step === 4 ? (
              <Button
                title="Send Challenge"
                onPress={handleSubmit}
                variant="primary"
                size="lg"
                loading={submitting}
                disabled={submitting}
                accessibilityLabel="Send challenge"
              />
            ) : (
              <Button
                title="Continue"
                onPress={goNext}
                variant="primary"
                size="lg"
                disabled={
                  (step === 1 && !canProceedFromStep1) ||
                  (step === 2 && !canProceedFromStep2) ||
                  (step === 3 && !canProceedFromStep3)
                }
                accessibilityLabel="Continue to next step"
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// --- Header with step indicator ---

function Header({
  step,
  totalSteps,
  onBack,
  title,
}: {
  step: Step;
  totalSteps: number;
  onBack?: () => void;
  title: string;
}) {
  const colors = lightTheme;

  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
          testID="back-button"
        >
          <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
        </Pressable>
      )}
      <Text
        style={[styles.headerTitle, { color: colors.textPrimary }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <Text style={[styles.stepIndicator, { color: colors.textTertiary }]} testID="step-indicator">
        {step}/{totalSteps}
      </Text>
    </View>
  );
}

// --- Habit selection option ---

function HabitOption({
  habit,
  selected,
  onSelect,
}: {
  habit: FriendHabit;
  selected: boolean;
  onSelect: () => void;
}) {
  const colors = lightTheme;

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`Select habit ${habit.name}`}
      testID={`habit-option-${habit.id}`}
    >
      <Card
        style={{
          ...styles.habitCard,
          ...shadows.sm,
          ...(selected ? { borderWidth: 2, borderColor: colors.brandPrimary } : {}),
        }}
      >
        <View style={styles.habitRow}>
          <View style={styles.habitFlame}>
            <Flame flameLevel={habit.flameLevel} size="md" consistency={habit.consistency} />
          </View>
          <View style={styles.habitInfo}>
            <Text style={[styles.habitName, { color: colors.textPrimary }]} numberOfLines={1}>
              {habit.icon ? `${habit.icon} ` : ""}{habit.name}
            </Text>
            <Text style={[styles.habitConsistency, { color: colors.textSecondary }]}>
              {Math.round(habit.consistency)}% consistency
            </Text>
          </View>
          <View
            style={[
              styles.radioOuter,
              { borderColor: selected ? colors.brandPrimary : colors.border },
            ]}
          >
            {selected && (
              <View style={[styles.radioInner, { backgroundColor: colors.brandPrimary }]} />
            )}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  backText: {
    fontSize: 24,
  },
  headerTitle: {
    ...typography.h3,
    flex: 1,
  },
  stepIndicator: {
    ...typography.label,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing["5xl"],
  },
  stepTitle: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  stepDescription: {
    ...typography.body,
    marginBottom: spacing.xl,
  },

  // Step 1: Habit list
  habitList: {
    gap: spacing.md,
  },
  habitCard: {
    padding: 0,
  },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  habitFlame: {
    width: 48,
    alignItems: "center",
  },
  habitInfo: {
    flex: 1,
  },
  habitName: {
    ...typography.body,
    fontWeight: "600",
  },
  habitConsistency: {
    ...typography.bodySmall,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: radii.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: radii.full,
  },
  emptyHabits: {
    paddingVertical: spacing["3xl"],
    alignItems: "center",
  },
  emptyText: {
    ...typography.body,
    textAlign: "center",
  },

  // Step 2: Target
  fieldGroup: {
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  fieldHint: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
  },
  sliderButton: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sliderButtonText: {
    fontSize: 22,
    fontWeight: "600",
  },
  sliderValue: {
    flex: 1,
    alignItems: "center",
  },
  targetValueText: {
    ...typography.h1,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  presetChip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  presetChipText: {
    ...typography.label,
  },

  // Step 3: Reward
  rewardExamples: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  examplesLabel: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  exampleChip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  exampleText: {
    ...typography.bodySmall,
  },

  // Step 4: Preview
  previewCard: {
    padding: spacing.xl,
  },
  previewSection: {
    paddingVertical: spacing.md,
  },
  previewLabel: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  previewValue: {
    ...typography.bodyLarge,
  },
  previewHabitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  previewDivider: {
    height: 1,
  },
  errorBanner: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  errorText: {
    ...typography.bodySmall,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.base,
    borderTopWidth: 1,
  },

  // Step 5: Success
  successContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing["3xl"],
  },
  successContent: {
    alignItems: "center",
    gap: spacing.xl,
  },
  successTitle: {
    ...typography.h2,
  },
  successMessage: {
    ...typography.body,
    textAlign: "center",
  },
  successAction: {
    marginTop: spacing.xl,
    width: "100%",
  },
});
