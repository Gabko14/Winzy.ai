import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Card, Button } from "../../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../../design-system";
import type { IncomingRequest } from "../../api/social";

function incomingDisplayName(request: IncomingRequest): string {
  if (request.fromDisplayName) return request.fromDisplayName;
  if (request.fromUsername) return `@${request.fromUsername}`;
  return `User ${request.fromUserId.slice(0, 8)}`;
}

function incomingInitials(request: IncomingRequest): string {
  if (request.fromDisplayName) {
    const parts = request.fromDisplayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (request.fromUsername) return request.fromUsername.slice(0, 2).toUpperCase();
  return request.fromUserId.slice(0, 2).toUpperCase();
}

type IncomingRequestsProps = {
  incoming: IncomingRequest[];
  processingIds: Set<string>;
  onAccept: (request: IncomingRequest) => void;
  onDecline: (request: IncomingRequest) => void;
};

export function IncomingRequestsList({
  incoming,
  processingIds,
  onAccept,
  onDecline,
}: IncomingRequestsProps) {
  return (
    <>
      {incoming.map((request) => (
        <Card key={request.id} style={styles.requestCard}>
          <View style={styles.requestRow}>
            <View style={styles.requestAvatar}>
              <Text style={styles.requestAvatarText}>
                {incomingInitials(request)}
              </Text>
            </View>
            <View style={styles.requestInfo}>
              <Text style={[styles.requestName, { color: lightTheme.textPrimary }]} numberOfLines={1}>
                {incomingDisplayName(request)}
              </Text>
              <Text style={[styles.requestMeta, { color: lightTheme.textSecondary }]}>
                Wants to be friends
              </Text>
            </View>
            <View style={styles.requestActions}>
              <Button
                title="Accept"
                onPress={() => onAccept(request)}
                variant="primary"
                size="sm"
                disabled={processingIds.has(request.id)}
                loading={processingIds.has(request.id)}
              />
              <Button
                title="Decline"
                onPress={() => onDecline(request)}
                variant="ghost"
                size="sm"
                disabled={processingIds.has(request.id)}
              />
            </View>
          </View>
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  requestCard: {
    padding: 0,
    ...shadows.sm,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  requestAvatar: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    backgroundColor: lightTheme.brandMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  requestAvatarText: {
    fontSize: 12,
    fontWeight: "600",
    color: lightTheme.brandPrimary,
  },
  requestInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  requestName: {
    ...typography.body,
    fontWeight: "600",
  },
  requestMeta: {
    ...typography.caption,
  },
  requestActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
});
