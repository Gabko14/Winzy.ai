/**
 * API types matching the Go auth module contract.
 *
 * Keep in sync with: backend/internal/auth/models.go
 * Spec: backend/openapi/openapi.yaml
 */

import type { components } from "./generated/schema";

type Schemas = components["schemas"];

export type UserProfile = Schemas["UserProfile"];
export type AuthResponse = Schemas["AuthResponse"];
export type UpdateProfileRequest = Schemas["UpdateProfileRequest"];

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
    | "rate_limited"
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
