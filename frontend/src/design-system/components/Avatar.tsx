import React, { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { radii } from "../tokens/spacing";
import { lightTheme } from "../tokens/colors";

export type AvatarSize = "sm" | "md" | "base" | "lg" | "xl";

export type AvatarProps = {
  initials: string;
  size?: AvatarSize;
  /** Absolute or same-origin avatar URL. Initials show while loading and on error. */
  imageUrl?: string | null;
  testID?: string;
};

const sizeMap: Record<AvatarSize, { container: number; fontSize: number }> = {
  sm: { container: 36, fontSize: 12 },
  md: { container: 44, fontSize: 16 },
  base: { container: 48, fontSize: 18 },
  lg: { container: 72, fontSize: 28 },
  xl: { container: 80, fontSize: 30 },
};

/**
 * Circle avatar: optional image with initials fallback while loading / on error.
 * Never shows a broken-image glyph; container size stays fixed (no layout shift).
 */
export function Avatar({ initials, size = "md", imageUrl, testID }: AvatarProps) {
  const colors = lightTheme;
  const dims = sizeMap[size];
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [imageUrl]);

  const showImage = Boolean(imageUrl) && !failed;

  return (
    <View
      style={[
        styles.container,
        {
          width: dims.container,
          height: dims.container,
          borderRadius: radii.full,
          backgroundColor: colors.brandMuted,
        },
      ]}
      testID={testID}
      accessibilityLabel={initials}
      accessibilityRole="image"
    >
      {(!showImage || !loaded) && (
        <Text style={[styles.text, { fontSize: dims.fontSize, color: colors.brandPrimary }]}>
          {initials}
        </Text>
      )}
      {showImage && (
        <Image
          source={{ uri: imageUrl as string }}
          style={[
            styles.image,
            {
              width: dims.container,
              height: dims.container,
              borderRadius: radii.full,
            },
          ]}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
          testID={testID ? `${testID}-image` : undefined}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  text: {
    fontWeight: "600",
  },
  image: {
    position: "absolute",
    top: 0,
    left: 0,
  },
});
