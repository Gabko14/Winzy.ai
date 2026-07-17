import type {
  CompletionDayEntry,
  CompletionKind,
  CompletionsRangeResponse,
  HabitCompletionsInRange,
} from "../api/habits";

export function findHabitInRange(
  data: CompletionsRangeResponse | undefined,
  habitId: string,
): HabitCompletionsInRange | undefined {
  return data?.habits.find((h) => h.id === habitId);
}

export function dayEntryFor(
  habit: HabitCompletionsInRange | undefined,
  date: string,
): CompletionDayEntry | undefined {
  return habit?.days.find((d) => d.date === date);
}

export function patchRangeDay(
  data: CompletionsRangeResponse,
  habitId: string,
  date: string,
  completed: boolean,
  completionKind: CompletionKind | null,
): CompletionsRangeResponse {
  return {
    ...data,
    habits: data.habits.map((h) => {
      if (h.id !== habitId) return h;
      return {
        ...h,
        days: h.days.map((d) =>
          d.date === date ? { ...d, completed, completionKind } : d,
        ),
      };
    }),
  };
}
