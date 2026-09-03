import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, typeRole } from '../../theme';

export type DetailRowProps = {
  label: string;
  value?: React.ReactNode;
  testID?: string;
  last?: boolean;
};

export function DetailRow({ label, value, testID, last = false }: DetailRowProps) {
  return (
    <View {...(testID ? { testID } : {})} style={[styles.row, last ? styles.last : null]}>
      <Text style={styles.label}>{label}</Text>
      {typeof value === 'string' ? <Text style={styles.value}>{value}</Text> : value}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: space.xs,
    paddingBottom: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  last: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  label: {
    color: color.textSecondary,
    fontSize: typeRole.caption.fontSize,
    lineHeight: typeRole.caption.lineHeight,
  },
  value: {
    color: color.textPrimary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
  },
});
