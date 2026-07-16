/**
 * Client-side validation matching backend rules.
 *
 * Keep in sync with:
 *   backend/internal/auth/validation.go (register/login validation)
 */

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EMAIL_MAX = 256;

/**
 * Character count the way the backend counts (Go rune count = Unicode code
 * points). JS `.length` counts UTF-16 code units, so an emoji counts as 2
 * there but 1 on the backend — using `.length` against backend limits lets
 * a too-short password through client-side ("123456😀" is length 8 but 7
 * characters) and blocks backend-valid long values.
 */
export function codePointLength(s: string): number {
  return [...s].length;
}

export type FieldError = string | null;

export function validateEmail(email: string): FieldError {
  const trimmed = email.trim();
  if (!trimmed) return "Email is required.";
  if (trimmed.length > EMAIL_MAX) return "Email must not exceed 256 characters.";
  if (!EMAIL_REGEX.test(trimmed)) return "Please enter a valid email address.";
  return null;
}

export function validateUsername(username: string): FieldError {
  const trimmed = username.trim();
  if (!trimmed) return "Username is required.";
  if (!USERNAME_REGEX.test(trimmed)) {
    if (trimmed.length < 3) return "Username must be at least 3 characters.";
    if (trimmed.length > 64) return "Username must not exceed 64 characters.";
    return "Username can only contain letters, digits, hyphens, and underscores.";
  }
  return null;
}

export function validatePassword(password: string): FieldError {
  if (!password) return "Password is required.";
  const chars = codePointLength(password);
  if (chars < PASSWORD_MIN) return "Password must be at least 8 characters.";
  if (chars > PASSWORD_MAX) return "Password must not exceed 128 characters.";
  return null;
}

export function validateLoginIdentifier(value: string): FieldError {
  if (!value.trim()) return "Email or username is required.";
  return null;
}
