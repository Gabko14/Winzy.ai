import { useCallback, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { isApiError } from "../api";
import { useAuth } from "./useAuth";

const AVATAR_SIZE = 512;

export function useAvatarUpload() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const pickAndUpload = useCallback(async () => {
    if (auth.status !== "authenticated") return;

    setError(null);
    setBusy(true);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (picked.canceled || !picked.assets[0]) {
        return;
      }

      const asset = picked.assets[0];
      const manipulated = await manipulateAsync(
        asset.uri,
        [{ resize: { width: AVATAR_SIZE, height: AVATAR_SIZE } }],
        { compress: 0.85, format: SaveFormat.JPEG },
      );

      const response = await fetch(manipulated.uri);
      const buffer = await response.arrayBuffer();
      await auth.uploadAvatar(buffer, "image/jpeg");
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === "network") {
          setError("Unable to reach the server. Please check your connection.");
        } else if (err.code === "validation") {
          setError("That image could not be used. Try a JPEG, PNG, or WebP under 512KB.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [auth]);

  const remove = useCallback(async () => {
    if (auth.status !== "authenticated") return;

    setError(null);
    setBusy(true);
    try {
      await auth.deleteAvatar();
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === "network") {
          setError("Unable to reach the server. Please check your connection.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [auth]);

  return { pickAndUpload, remove, busy, error, clearError };
}
