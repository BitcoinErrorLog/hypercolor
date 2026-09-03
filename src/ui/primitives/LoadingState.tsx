import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { color, space, typeRole } from '../../theme';

export type LoadingStateProps = {
  label?: string;
  testID?: string;
};

export function LoadingState({ label = 'Loading', testID }: LoadingStateProps) {
  return (
    <View
      {...(testID ? { testID } : {})}
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <ActivityIndicator size="large" color={color.brand} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
    backgroundColor: color.canvas,
  },
  label: {
    color: color.textSecondary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
  },
});
