import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space, typeRole } from '../../theme';

export type BadgeTone = 'neutral' | 'brand' | 'warning' | 'success' | 'danger';

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  testID?: string;
};

const toneStyles: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: color.surfaceRaised, fg: color.textSecondary },
  brand: { bg: color.surfaceBrand, fg: color.brandMuted },
  warning: { bg: color.chipWarning, fg: color.warningStrong },
  success: { bg: color.chipSuccess, fg: color.success },
  danger: { bg: color.chipDanger, fg: color.danger },
};

export function Badge({ label, tone = 'neutral', testID }: BadgeProps) {
  const palette = toneStyles[tone];
  return (
    <View
      {...(testID ? { testID } : {})}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: palette.bg }]}
    >
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    minHeight: 24,
    justifyContent: 'center',
  },
  label: {
    fontSize: typeRole.label.fontSize,
    lineHeight: typeRole.label.lineHeight,
    fontWeight: typeRole.label.fontWeight,
  },
});
