import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { HIT_SLOP_44 } from './hitTarget';

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
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1f1b2e',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#7c3aed',
  },
  label: { flex: 1, color: '#f9fafb', fontSize: 14, lineHeight: 20 },
  action: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 },
  actionText: { color: '#8f57f0', fontSize: 15, fontWeight: '700' },
});
