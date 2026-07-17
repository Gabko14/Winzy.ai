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
  friends: {
    /** Paginated friends list. */
    list: () => ["friends"] as const,
    /** Incoming + outgoing friend requests. */
    requests: () => ["friend-requests"] as const,
    /** Pending incoming request count (badge). */
    pendingCount: () => ["friends", "pending-count"] as const,
  },
  friend: {
    /** Friend profile (habits + flames visible to the viewer). */
    profile: (id: string) => ["friend", id, "profile"] as const,
  },
  visibility: {
    /** Batch per-habit visibility map + default. */
    batch: () => ["visibility"] as const,
    /** User default habit visibility preference. */
    preferences: () => ["visibility", "preferences"] as const,
  },
  feed: {
    /** Activity feed (infinite / cursor pages share this root). */
    list: (limit = 20) => ["feed", limit] as const,
  },
  users: {
    /** Debounced user search for Add Friend. */
    search: (query: string) => ["users", "search", query] as const,
  },
  witnessLinks: {
    /** Managed witness links for the current user. */
    list: () => ["witness-links"] as const,
  },
  witness: {
    /** Public witness viewer by token. */
    view: (token: string) => ["witness", token] as const,
  },
  // Sibling domain (d56m.3) — keep in sync with challenges/notifications migrations.
  challenges: {
    list: () => ["challenges"] as const,
    detail: (id: string) => ["challenge", id] as const,
  },
  notifications: {
    list: (pageSize = 20) => ["notifications", pageSize] as const,
    unreadCount: () => ["notifications", "unread-count"] as const,
  },
} as const;
