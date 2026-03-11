/**
 * API types matching the backend contract.
 *
 * Keep in sync with:
 *   services/auth-service/src/Models/AuthModels.cs
 */

export type UserProfile = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string | null;
  user: UserProfile;
};

export type ValidationProblem = {
  type: string;
  title: string;
  status: number;
  errors: Record<string, string[]>;
};

/**
 * Structured API error surfaced to callers.
 * `status` is the HTTP status code (0 for network errors).
 * `code` is a machine-readable error category.
 */
export type ApiError = {
  status: number;
  code:
    | "network"
    | "timeout"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "validation"
    | "server_error"
    | "unknown";
  message: string;
  validationErrors?: Record<string, string[]>;
};

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "code" in value &&
    "message" in value
  );
}
