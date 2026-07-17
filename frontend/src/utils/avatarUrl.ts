import { getBaseUrl } from "../api/client";

/** Public serving path for a user's avatar (may 404 if none uploaded). */
export function userAvatarPath(userId: string): string {
  return `/auth/users/${encodeURIComponent(userId)}/avatar`;
}

/**
 * Builds an absolute Image URI from an API avatar path (or absolute URL).
 * Optional cacheBust (e.g. updatedAt) appends ?v= so Cache-Control: max-age
 * does not keep a stale photo after upload.
 */
export function resolveAvatarUrl(
  avatarUrl: string | null | undefined,
  cacheBust?: string | null,
): string | undefined {
  if (!avatarUrl) return undefined;

  let path = avatarUrl;
  if (cacheBust) {
    const sep = path.includes("?") ? "&" : "?";
    path = `${path}${sep}v=${encodeURIComponent(cacheBust)}`;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const base = getBaseUrl().replace(/\/$/, "");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
