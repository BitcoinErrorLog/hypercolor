import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { COPY } from '../copy/uxCopy';

export function CustodyLine({ testID }: { testID?: string }) {
  return (
    <Text testID={testID ?? 'custodyLine'} style={styles.line}>
      {COPY.custodyLine}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    fontSize: 14,
    color: '#808692',
    lineHeight: 20,
    textAlign: 'center',
  },
});
