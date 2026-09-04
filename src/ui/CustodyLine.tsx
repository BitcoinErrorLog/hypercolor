import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { color, typeRole } from '../theme';

export function CustodyLine({ testID }: { testID?: string }) {
  return (
    <Text testID={testID ?? 'custodyLine'} style={styles.line}>
      {COPY.custodyLine}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    fontSize: typeRole.secondary.fontSize,
    color: color.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
  },
});
