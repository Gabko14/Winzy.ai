import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Avatar, Card, Badge, Button } from "../../design-system";
import { spacing, typography, lightTheme, shadows } from "../../design-system";
import type { OutgoingRequest } from "../../api/social";
import { getInitials } from "../../utils/getInitials";
import { resolveAvatarUrl } from "../../utils/avatarUrl";

function outgoingDisplayName(request: OutgoingRequest): string {
  if (request.toDisplayName) return request.toDisplayName;
  if (request.toUsername) return `@${request.toUsername}`;
  return `User ${request.toUserId.slice(0, 8)}`;
}

type OutgoingRequestsProps = {
  outgoing: OutgoingRequest[];
  processingIds: Set<string>;
  onCancel: (request: OutgoingRequest) => void;
};

export function OutgoingRequestsList({
  outgoing,
  processingIds,
  onCancel,
}: OutgoingRequestsProps) {
  return (
    <>
      {outgoing.map((request) => (
        <Card key={request.id} style={styles.requestCard}>
          <View style={styles.requestRow}>
            <Avatar
              initials={getInitials(request.toDisplayName, request.toUsername, request.toUserId)}
              size="sm"
              imageUrl={resolveAvatarUrl(request.avatarUrl)}
            />
            <View style={styles.requestInfo}>
              <Text style={[styles.requestName, { color: lightTheme.textPrimary }]} numberOfLines={1}>
                {outgoingDisplayName(request)}
              </Text>
              <Badge label="Pending" variant="default" />
            </View>
            <Button
              title="Cancel"
              onPress={() => onCancel(request)}
              variant="ghost"
              size="sm"
              disabled={processingIds.has(request.id)}
            />
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
  requestInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  requestName: {
    ...typography.body,
    fontWeight: "600",
  },
});
