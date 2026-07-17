import { api, apiRequest } from "./client";
import type { components } from "./generated/schema";
import type { UserProfile } from "./types";

export type AvatarUploadResponse = components["schemas"]["AvatarUploadResponse"];

export function uploadAvatar(
  body: ArrayBuffer | Blob | Uint8Array,
  contentType: string,
): Promise<AvatarUploadResponse> {
  return apiRequest<AvatarUploadResponse>("/auth/avatar", {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
    timeout: 30_000,
  });
}

export function deleteAvatar(): Promise<void> {
  return api.delete<void>("/auth/avatar");
}

export function fetchProfile(): Promise<UserProfile> {
  return api.get<UserProfile>("/auth/profile");
}
