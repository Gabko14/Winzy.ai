const STORAGE_KEY = "winzy.challengeInviteToken";

let memoryToken: string | null = null;

function canUseSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

export function setPendingChallengeInviteToken(token: string): void {
  memoryToken = token;
  if (canUseSessionStorage()) {
    sessionStorage.setItem(STORAGE_KEY, token);
  }
}

export function getPendingChallengeInviteToken(): string | null {
  if (memoryToken) return memoryToken;
  if (!canUseSessionStorage()) return null;
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) memoryToken = stored;
  return stored;
}

export function clearPendingChallengeInviteToken(): void {
  memoryToken = null;
  if (canUseSessionStorage()) {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}
