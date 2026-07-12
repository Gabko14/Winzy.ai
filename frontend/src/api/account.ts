import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// Keep in sync with: backend/internal/auth/handlers.go (Export)
// Spec: backend/openapi/openapi.yaml

export type ExportBundle = Schemas["ExportBundle"];

export async function exportMyData(): Promise<ExportBundle> {
  return api.get<ExportBundle>("/auth/export");
}
