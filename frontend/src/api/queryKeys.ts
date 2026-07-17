/**
 * Canonical TanStack Query key factories.
 *
 * Conventions (pattern for sibling domains):
 * - Export factories only — never inline string keys at call sites.
 * - Use stable tuple shapes; invalidate via the shared prefix when a mutation
 *   should refresh a whole family (e.g. `queryKeys.habits.detail(id)` covers
 *   detail + stats under `['habit', id, ...]`).
 * - Domain root: plural resource name for lists (`['habits']`).
 * - Singular resource + id for entity trees (`['habit', id]`).
 */
export const queryKeys = {
  habits: {
    /** List of the current user's habits — shared by useHabits + useTodayHabits. */
    list: () => ["habits"] as const,
    /** Single habit entity. */
    detail: (id: string) => ["habit", id] as const,
    /** Per-habit stats (includes completedToday / flame). Timezone is part of the key. */
    stats: (id: string, timezone: string) => ["habit", id, "stats", timezone] as const,
  },
  completions: {
    /** GET /habits/completions?from=&to= — inclusive date range. */
    range: (from: string, to: string) => ["completions", from, to] as const,
  },
} as const;
