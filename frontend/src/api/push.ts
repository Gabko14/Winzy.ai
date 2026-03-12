import { api, apiRequest } from "./client";

// --- Types ---

export type RegisterDeviceRequest = {
  platform: "web_push" | "expo_push";
  token: string;
  deviceId?: string;
};

export type UnregisterDeviceRequest = {
  deviceId: string;
};

export type VapidKeyResponse = {
  publicKey: string;
};

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
