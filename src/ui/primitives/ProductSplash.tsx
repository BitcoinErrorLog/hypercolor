import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { color, space, typeRole } from '../../theme';

export type ProductSplashProps = {
  footer?: React.ReactNode;
  testID?: string;
};

export function ProductSplash({ footer, testID = 'appSplash' }: ProductSplashProps) {
  return (
    <View style={styles.loading} testID={testID}>
      <Text testID="productSplashWordmark" accessibilityRole="header" style={styles.wordmark}>
        Hypercolor
      </Text>
      <ActivityIndicator size="large" color={color.brand} />
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.canvas,
    gap: space.lg,
  },
  wordmark: {
    fontSize: typeRole.display.fontSize,
    lineHeight: typeRole.display.lineHeight,
    fontWeight: typeRole.display.fontWeight,
    color: color.textPrimary,
  },
});
