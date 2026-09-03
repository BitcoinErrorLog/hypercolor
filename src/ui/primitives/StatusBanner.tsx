import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, measure, space, typeRole } from '../../theme';

export type StatusBannerTone = 'info' | 'warning' | 'danger' | 'success';

export type StatusBannerProps = {
  label: string;
  tone?: StatusBannerTone;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
};

const toneColor: Record<StatusBannerTone, string> = {
  info: color.brandText,
  warning: color.warningStrong,
  danger: color.danger,
  success: color.success,
};

export function StatusBanner({
  label,
  tone = 'info',
  actionLabel,
  onAction,
  testID,
}: StatusBannerProps) {
  const accent = toneColor[tone];
  return (
    <View
      testID={testID ?? 'statusBanner'}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { borderBottomColor: accent, backgroundColor: color.surfaceBrand }]}
    >
      <Text style={[styles.label, { color: color.textPrimary }]}>{label}</Text>
      {actionLabel && onAction ? (
        <Pressable
          testID={`${testID ?? 'statusBanner'}Action`}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={styles.action}
        >
          <Text style={[styles.actionText, { color: accent }]}>{actionLabel}</Text>
        </Pressable>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    flex: 1,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: typeRole.secondary.lineHeight,
  },
  action: {
    minHeight: measure.hitTarget,
    minWidth: measure.hitTarget,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  actionText: {
    fontSize: typeRole.callout.fontSize,
    lineHeight: typeRole.callout.lineHeight,
    fontWeight: typeRole.bodyStrong.fontWeight,
  },
});
