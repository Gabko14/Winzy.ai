/**
 * Extracts up to 2-character initials from a display name, username, or fallback ID.
 *
 * Priority: displayName > username > fallbackId > "??"
 *
 * For display names with 2+ words, uses first letter of first and last word.
 * For single words, uses first 2 characters.
 */
export function getInitials(
  displayName?: string | null,
  username?: string | null,
  fallbackId?: string | null,
): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (username) return username.slice(0, 2).toUpperCase();
  if (fallbackId) return fallbackId.slice(0, 2).toUpperCase();
  return "??";
}
