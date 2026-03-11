/**
 * Client-side validation matching backend rules.
 *
 * Keep in sync with:
 *   services/auth-service/src/Validation/ValidationFilter.cs
 *   services/auth-service/src/Models/AuthModels.cs
 */

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EMAIL_MAX = 256;

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
  if (password.length < PASSWORD_MIN) return "Password must be at least 8 characters.";
  if (password.length > PASSWORD_MAX) return "Password must not exceed 128 characters.";
  return null;
}

export function validateLoginIdentifier(value: string): FieldError {
  if (!value.trim()) return "Email or username is required.";
  return null;
}
