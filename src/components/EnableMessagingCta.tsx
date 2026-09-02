import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COPY } from '../copy/uxCopy';

export function EnableMessagingCta({ onPress, testID }: { onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={COPY.enableEncryptedMessaging}
      style={styles.cta}
      onPress={onPress}
    >
      <Text style={styles.title}>{COPY.messagingNotEnabled}</Text>
      <Text style={styles.hint}>{COPY.approveScopesBody}</Text>
      <Text style={styles.action}>{COPY.enableEncryptedMessaging}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cta: {
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#1f1b2e',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#7c3aed',
    gap: 4,
  },
  title: { fontSize: 15, fontWeight: '600', color: '#f9fafb' },
  hint: { fontSize: 13, color: '#c4b5fd' },
  action: { fontSize: 15, fontWeight: '700', color: '#fff', marginTop: 6 },
});
