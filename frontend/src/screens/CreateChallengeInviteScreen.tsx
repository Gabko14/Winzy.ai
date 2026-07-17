import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Share,
  Alert,
} from "react-native";
import {
  Button,
  Card,
  TextInput,
  AnimatedCheckmark,
  FadeIn,
  ScreenHeader,
  InlineError,
  LoadingState,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { IconPicker, DEFAULT_HABIT_ICON } from "../components/IconPicker";
import {
  ChallengeTargetPeriodFields,
  ChallengeRewardFields,
  DEFAULT_TARGET,
  DEFAULT_PERIOD,
  isRewardValid,
  isTargetPeriodValid,
} from "../components/challengeWizardShared";
import {
  useChallengeInvites,
  useCreateChallengeInvite,
  useRevokeChallengeInvite,
} from "../hooks/useChallengeInvites";
import type { ChallengeInvite, CreateChallengeInviteResponse } from "../api/challenges";
import type { FrequencyType } from "../api/habits";
import { validateHabitName, validateCustomDays } from "../utils/habitValidation";
import type { ApiError } from "../api/types";
import { isApiError } from "../api/types";

type Step = 1 | 2 | 3 | 4 | 5;

const FREQUENCY_OPTIONS: { value: FrequencyType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  onBack?: () => void;
  onComplete?: () => void;
};

export function buildInviteShareMessage(habitName: string, reward: string, url: string): string {
  return `I challenge you to ${habitName} — ${reward}. ${url}`;
}

export async function copyInviteText(text: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
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

export async function shareInviteText(message: string, url: string): Promise<"shared" | "copied" | "failed"> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text: message, url });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "failed";
    }
  }
  if (Platform.OS !== "web") {
    try {
      await Share.share({ message, url });
      return "shared";
    } catch {
      return "failed";
    }
  }
  const copied = await copyInviteText(url);
  return copied ? "copied" : "failed";
}

export function CreateChallengeInviteScreen({ onBack, onComplete }: Props) {
  const colors = lightTheme;
  const [step, setStep] = useState<Step>(1);
  const [habitName, setHabitName] = useState("");
  const [habitIcon, setHabitIcon] = useState(DEFAULT_HABIT_ICON);
  const [frequency, setFrequency] = useState<FrequencyType>("daily");
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [targetValue, setTargetValue] = useState(DEFAULT_TARGET);
  const [periodDays, setPeriodDays] = useState(DEFAULT_PERIOD);
  const [rewardDescription, setRewardDescription] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [daysError, setDaysError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<CreateChallengeInviteResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const { invites, loading: loadingInvites } = useChallengeInvites();
  const createMutation = useCreateChallengeInvite((result) => {
    setCreated(result);
    setStep(5);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  });
  const revokeMutation = useRevokeChallengeInvite();

  const rewardTrimmed = rewardDescription.trim();
  const canProceedFromStep1 = useMemo(() => {
    return !validateHabitName(habitName) && !validateCustomDays(frequency, customDays);
  }, [habitName, frequency, customDays]);
  const canProceedFromStep2 = isTargetPeriodValid(targetValue, periodDays);
  const canProceedFromStep3 = isRewardValid(rewardDescription);

  const goNext = useCallback(() => {
    if (step === 1) {
      const nErr = validateHabitName(habitName) ?? undefined;
      const dErr = validateCustomDays(frequency, customDays) ?? undefined;
      setNameError(nErr);
      setDaysError(dErr);
      if (nErr || dErr) return;
    }
    setStep((s) => Math.min(s + 1, 5) as Step);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [step, habitName, frequency, customDays]);

  const goBack = useCallback(() => {
    if (step === 1 || step === 5) {
      onBack?.();
    } else {
      setStep((s) => (s - 1) as Step);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [step, onBack]);

  const toggleDay = useCallback((day: number) => {
    setCustomDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
    setDaysError(undefined);
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    try {
      const request = {
        habitName: habitName.trim(),
        habitIcon: habitIcon || undefined,
        frequency,
        ...(frequency === "weekly" || frequency === "custom" ? { customDays } : {}),
        milestoneType: "consistencyTarget" as const,
        targetValue,
        periodDays,
        rewardDescription: rewardTrimmed,
      };
      await createMutation.create(request);
    } catch (err) {
      setSubmitError(
        isApiError(err)
          ? err
          : { status: 0, code: "unknown", message: "Something went wrong. Please try again." },
      );
    }
  }, [
    habitName,
    habitIcon,
    frequency,
    customDays,
    targetValue,
    periodDays,
    rewardTrimmed,
    createMutation,
  ]);

  const submitErrorMessage = useMemo(() => {
    if (!submitError) return null;
    if (submitError.status === 409 || submitError.code === "conflict") {
      return "You've hit the limit of 20 pending invites. Revoke one below, then try again.";
    }
    if (submitError.code === "validation" && submitError.validationErrors) {
      const messages = Object.values(submitError.validationErrors).flat();
      return messages.join(". ") || submitError.message;
    }
    return submitError.message;
  }, [submitError]);

  const shareMessage = created
    ? buildInviteShareMessage(habitName.trim(), rewardTrimmed, created.url)
    : "";

  const handleCopy = useCallback(async () => {
    if (!created) return;
    const ok = await copyInviteText(created.url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      Alert.alert("Copy failed", "Could not copy the invite link.");
    }
  }, [created]);

  const handleShare = useCallback(async () => {
    if (!created) return;
    const result = await shareInviteText(shareMessage, created.url);
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (result === "failed") {
      Alert.alert("Share unavailable", "Copy the link instead and send it your own way.");
    }
  }, [created, shareMessage]);

  const handleRevoke = useCallback(
    (invite: ChallengeInvite) => {
      Alert.alert(
        "Revoke invite?",
        `Anyone with the link for "${invite.habitName}" will no longer be able to join.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Revoke",
            style: "destructive",
            onPress: () => {
              void revokeMutation.revoke(invite.id).catch(() => {
                Alert.alert("Could not revoke", "Please try again in a moment.");
              });
            },
          },
        ],
      );
    },
    [revokeMutation],
  );

  const selectedDaysSet = useMemo(() => new Set(customDays), [customDays]);

  if (step === 5 && created) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="create-challenge-invite-success">
        <View style={styles.successContainer}>
          <FadeIn>
            <View style={styles.successContent}>
              <AnimatedCheckmark visible size={64} />
              <Text style={[styles.successTitle, { color: colors.textPrimary }]}>
                Invite ready!
              </Text>
              <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
                Share this link. When they join Winzy, the challenge starts automatically.
              </Text>
              <Card style={{ ...styles.linkCard, ...shadows.sm }}>
                <Text style={[styles.linkLabel, { color: colors.textTertiary }]}>INVITE LINK</Text>
                <Text style={[styles.linkValue, { color: colors.textPrimary }]} testID="invite-url" selectable>
                  {created.url}
                </Text>
              </Card>
              <View style={styles.successActions}>
                <Button
                  title={copied ? "Copied!" : "Copy link"}
                  onPress={handleCopy}
                  variant="primary"
                  size="lg"
                  accessibilityLabel="Copy invite link"
                />
                <Button
                  title="Share"
                  onPress={handleShare}
                  variant="secondary"
                  size="lg"
                  accessibilityLabel="Share invite"
                />
                <Button
                  title="Done"
                  onPress={() => {
                    if (onComplete) onComplete();
                    else onBack?.();
                  }}
                  variant="ghost"
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
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="create-challenge-invite-screen">
      <ScreenHeader
        title="Challenge Invite"
        onBack={goBack}
        right={
          <Text style={[styles.stepIndicator, { color: lightTheme.textTertiary }]} testID="step-indicator">
            {step}/4
          </Text>
        }
      />

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
          testID="create-challenge-invite-scroll"
        >
          {step === 1 && (
            <View testID="step-1-propose-habit">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                Propose a habit
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                They'll get this habit when they accept your invite. Pick something encouraging.
              </Text>

              <View style={styles.fieldGroup}>
                <TextInput
                  label="Habit name"
                  placeholder="e.g., Morning run"
                  value={habitName}
                  onChangeText={(t) => {
                    setHabitName(t);
                    if (nameError) setNameError(undefined);
                  }}
                  validationState={nameError ? "error" : "default"}
                  errorMessage={nameError}
                  testID="invite-habit-name"
                  accessibilityLabel="Proposed habit name"
                />
              </View>

              <IconPicker value={habitIcon} onChange={setHabitIcon} />

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>Frequency</Text>
                <View style={styles.frequencyRow} testID="frequency-picker">
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        setFrequency(opt.value);
                        if (daysError) setDaysError(undefined);
                      }}
                      style={[
                        styles.frequencyOption,
                        {
                          backgroundColor:
                            frequency === opt.value ? colors.brandPrimary : colors.backgroundSecondary,
                          borderColor: frequency === opt.value ? colors.brandPrimary : colors.border,
                        },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: frequency === opt.value }}
                      testID={`freq-${opt.value}`}
                    >
                      <Text
                        style={[
                          styles.frequencyText,
                          {
                            color: frequency === opt.value ? colors.textInverse : colors.textPrimary,
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {(frequency === "weekly" || frequency === "custom") && (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>Days</Text>
                  <View style={styles.daysRow} testID="days-picker">
                    {DAY_LABELS.map((label, i) => (
                      <Pressable
                        key={label}
                        onPress={() => toggleDay(i)}
                        style={[
                          styles.dayOption,
                          {
                            backgroundColor: selectedDaysSet.has(i)
                              ? colors.brandPrimary
                              : colors.backgroundSecondary,
                            borderColor: selectedDaysSet.has(i) ? colors.brandPrimary : colors.border,
                          },
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selectedDaysSet.has(i) }}
                        accessibilityLabel={label}
                        testID={`day-${label}`}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            {
                              color: selectedDaysSet.has(i) ? colors.textInverse : colors.textPrimary,
                            },
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {daysError && (
                    <Text style={[styles.fieldError, { color: colors.error }]} testID="days-error">
                      {daysError}
                    </Text>
                  )}
                </View>
              )}

              <View style={styles.pendingSection} testID="pending-invites-section">
                <Text style={[styles.pendingTitle, { color: colors.textPrimary }]}>
                  Pending invites
                </Text>
                {loadingInvites ? (
                  <LoadingState message="Loading invites..." />
                ) : invites.length === 0 ? (
                  <Text style={[styles.pendingEmpty, { color: colors.textSecondary }]}>
                    No pending invites yet.
                  </Text>
                ) : (
                  invites.map((invite) => (
                    <Card key={invite.id} style={{ ...styles.pendingCard, ...shadows.sm }}>
                      <View style={styles.pendingRow}>
                        <View style={styles.pendingInfo}>
                          <Text style={[styles.pendingHabit, { color: colors.textPrimary }]} numberOfLines={1}>
                            {invite.habitIcon ? `${invite.habitIcon} ` : ""}
                            {invite.habitName}
                          </Text>
                          <Text style={[styles.pendingMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                            {invite.targetValue}% · {invite.periodDays} days
                          </Text>
                        </View>
                        <Button
                          title="Revoke"
                          onPress={() => handleRevoke(invite)}
                          variant="ghost"
                          size="sm"
                          disabled={revokeMutation.loading}
                          accessibilityLabel={`Revoke invite for ${invite.habitName}`}
                        />
                      </View>
                    </Card>
                  ))
                )}
              </View>
            </View>
          )}

          {step === 2 && (
            <View testID="step-2-set-target">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                Set the consistency goal
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                What consistency should they aim for on &quot;{habitName.trim()}&quot;?
                Focus on achievable progress, not perfection.
              </Text>
              <ChallengeTargetPeriodFields
                targetValue={targetValue}
                periodDays={periodDays}
                onTargetChange={setTargetValue}
                onPeriodChange={setPeriodDays}
              />
            </View>
          )}

          {step === 3 && (
            <View testID="step-3-reward">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                What will you do together?
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                When they hit the goal, what shared experience will you enjoy?
              </Text>
              <ChallengeRewardFields value={rewardDescription} onChange={setRewardDescription} />
            </View>
          )}

          {step === 4 && (
            <View testID="step-4-preview">
              <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
                Review your invite
              </Text>
              <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
                Make sure everything looks right before creating the link.
              </Text>

              <Card style={{ ...styles.previewCard, ...shadows.md }}>
                <View style={styles.previewSection}>
                  <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>HABIT</Text>
                  <Text style={[styles.previewValue, { color: colors.textPrimary }]} testID="preview-habit">
                    {habitIcon ? `${habitIcon} ` : ""}
                    {habitName.trim()}
                  </Text>
                  <Text style={[styles.previewMeta, { color: colors.textSecondary }]}>
                    {frequency}
                    {(frequency === "weekly" || frequency === "custom") && customDays.length > 0
                      ? ` · ${customDays.map((d) => DAY_LABELS[d]).join(", ")}`
                      : ""}
                  </Text>
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

              {submitError && submitErrorMessage && (
                <InlineError message={submitErrorMessage} testID="submit-error" />
              )}
            </View>
          )}
        </ScrollView>

        {step < 5 && (
          <View
            style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}
            testID="bottom-bar"
          >
            {step === 4 ? (
              <Button
                title="Create invite"
                onPress={handleSubmit}
                variant="primary"
                size="lg"
                loading={createMutation.loading}
                disabled={createMutation.loading}
                accessibilityLabel="Create challenge invite"
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  stepIndicator: { ...typography.label },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing["5xl"],
  },
  stepTitle: { ...typography.h3, marginBottom: spacing.sm },
  stepDescription: { ...typography.body, marginBottom: spacing.xl },
  fieldGroup: { marginBottom: spacing.xl },
  fieldLabel: { ...typography.label, marginBottom: spacing.sm },
  fieldError: { ...typography.caption, marginTop: spacing.xs },
  frequencyRow: { flexDirection: "row", gap: spacing.sm },
  frequencyOption: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
  },
  frequencyText: { ...typography.label },
  daysRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  dayOption: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: { ...typography.caption, fontWeight: "600" },
  pendingSection: { marginTop: spacing["2xl"], gap: spacing.md },
  pendingTitle: { ...typography.label },
  pendingEmpty: { ...typography.bodySmall },
  pendingCard: { padding: 0 },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  pendingInfo: { flex: 1 },
  pendingHabit: { ...typography.body, fontWeight: "600" },
  pendingMeta: { ...typography.caption },
  previewCard: { padding: spacing.xl },
  previewSection: { paddingVertical: spacing.md },
  previewLabel: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  previewValue: { ...typography.bodyLarge },
  previewMeta: { ...typography.bodySmall, marginTop: spacing.xs },
  previewDivider: { height: 1 },
  bottomBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.base,
    borderTopWidth: 1,
  },
  successContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing["3xl"],
  },
  successContent: { alignItems: "center", gap: spacing.xl, width: "100%" },
  successTitle: { ...typography.h2 },
  successMessage: { ...typography.body, textAlign: "center" },
  linkCard: { width: "100%", padding: spacing.xl },
  linkLabel: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  linkValue: { ...typography.body },
  successActions: { width: "100%", gap: spacing.md },
});
