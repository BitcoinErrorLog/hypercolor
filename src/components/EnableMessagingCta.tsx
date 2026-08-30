import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

export function EnableMessagingCta({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityLabel="Enable encrypted messaging"
      style={styles.cta}
      onPress={onPress}
    >
      <Text style={styles.title}>Enable encrypted messaging</Text>
      <Text style={styles.hint}>Approve Paykit + Hypercolor write access in Pubky Ring</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cta: {
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1f1b2e',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#7c3aed',
    gap: 4,
  },
  title: { fontSize: 15, fontWeight: '600', color: '#f9fafb' },
  hint: { fontSize: 13, color: '#a78bfa' },
});
