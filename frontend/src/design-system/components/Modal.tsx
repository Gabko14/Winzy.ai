import React from "react";
import { Modal as RNModal, View, Text, Pressable, StyleSheet } from "react-native";
import { spacing, radii, shadows } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";

export type ModalProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export function Modal({ visible, onClose, title, children }: ModalProps) {
  const colors = lightTheme;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.overlay, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close modal"
      >
        <Pressable
          style={[styles.content, shadows.lg, { backgroundColor: colors.surface }]}
          onPress={(e) => e?.stopPropagation()}
        >
          {title && (
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <Text style={[styles.closeButton, { color: colors.textSecondary }]}>
                  {"\u2715"}
                </Text>
              </Pressable>
            </View>
          )}
          <View style={styles.body}>{children}</View>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  content: {
    width: "100%",
    maxWidth: 480,
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.h3,
    flex: 1,
  },
  closeButton: {
    fontSize: 20,
    paddingLeft: spacing.base,
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
});
