import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { HIT_SLOP_44 } from './hitTarget';
import { color, space, typeRole, measure } from '../theme';

export function StatusBanner({
  label,
  actionLabel,
  onAction,
  testID,
  accessibilityRole = 'alert',
}: {
  label: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  accessibilityRole?: 'alert';
}) {
  return (
    <View
      testID={testID ?? 'statusBanner'}
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion="polite"
      style={styles.banner}
    >
      <Text style={styles.label}>{label}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          testID={`${testID ?? 'statusBanner'}Action`}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={HIT_SLOP_44}
          onPress={onAction}
          style={styles.action}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.surfaceBrand,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.brand,
  },
  label: { flex: 1, color: color.textPrimary, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
  action: { minHeight: measure.hitTarget, minWidth: measure.hitTarget, justifyContent: 'center', paddingHorizontal: space.sm },
  actionText: { color: color.brandText, fontSize: typeRole.callout.fontSize, fontWeight: '700' },
});
