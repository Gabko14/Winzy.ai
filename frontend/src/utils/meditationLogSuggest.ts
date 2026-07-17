export const MEDITATION_NAME_HINT = /medit|breath|mindful|calm|zen/i;

export type SuggestableHabit = {
  id: string;
  name: string;
};

/**
 * Preselect for "Log to habit":
 * (1) last logged habit if still in the list, else
 * (2) first name match against meditation/breath cues, else
 * (3) null (none selected).
 */
export function suggestHabitId(
  habits: SuggestableHabit[],
  lastLoggedHabitId: string | null | undefined,
): string | null {
  if (habits.length === 0) return null;

  if (lastLoggedHabitId) {
    const stillThere = habits.find((h) => h.id === lastLoggedHabitId);
    if (stillThere) return stillThere.id;
  }

  const byName = habits.find((h) => MEDITATION_NAME_HINT.test(h.name));
  return byName?.id ?? null;
}
