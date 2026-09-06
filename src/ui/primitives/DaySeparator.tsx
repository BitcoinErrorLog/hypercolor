import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, typeRole } from '../../theme';

export type DaySeparatorProps = {
  label: string;
  testID?: string;
};

export function formatDaySeparator(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function sameCalendarDay(leftMs: number, rightMs: number): boolean {
  return new Date(leftMs).toDateString() === new Date(rightMs).toDateString();
}

export function DaySeparator({ label, testID }: DaySeparatorProps) {
  return (
    <View style={styles.wrap}>
      <Text
        {...(testID ? { testID } : {})}
        accessible
        accessibilityRole="header"
        accessibilityLabel={label}
        role="heading"
        style={styles.label}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: space.md },
  label: {
    color: color.textMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
});
