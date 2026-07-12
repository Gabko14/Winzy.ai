import { api, apiRequest } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Types ---
// Keep in sync with: backend/internal/notifications/handlers.go
// Spec: backend/openapi/openapi.yaml

export type RegisterDeviceRequest = Schemas["RegisterDeviceRequest"];
export type UnregisterDeviceRequest = Schemas["UnregisterDeviceRequest"];
export type VapidKeyResponse = Schemas["VapidKeyResponse"];

// --- API functions ---

export function registerDevice(request: RegisterDeviceRequest): Promise<void> {
  return api.post("/notifications/devices", request);
}

export function unregisterDevice(request: UnregisterDeviceRequest): Promise<void> {
  return apiRequest("/notifications/devices", { method: "DELETE", body: request });
}

export function fetchVapidPublicKey(): Promise<VapidKeyResponse> {
  return api.get<VapidKeyResponse>("/notifications/vapid-public-key");
}
