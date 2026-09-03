import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CONTACTS_ERROR, CONTACTS_MUTED, MIN_TARGET } from './tokens';

export function ContactErrorBlock({
  message,
  details,
  onRetry,
  retryLabel = 'Try again',
}: {
  message: string;
  details?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap} accessibilityRole="alert" accessibilityLabel={message}>
      <View style={styles.row}>
        <Text style={styles.mark} importantForAccessibility="no">
          !
        </Text>
        <Text style={styles.message}>{message}</Text>
      </View>
      {details ? (
        <Pressable
          testID="contactErrorDetailsToggle"
          accessibilityRole="button"
          accessibilityLabel={open ? 'Hide details' : 'Show details'}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(v => !v)}
          style={styles.detailsToggle}
        >
          <Text style={styles.detailsLabel}>Details</Text>
        </Pressable>
      ) : null}
      {open && details ? (
        <Text testID="contactErrorDetails" style={styles.details} selectable>
          {details}
        </Text>
      ) : null}
      {onRetry ? (
        <Pressable
          testID="contactErrorRetry"
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  mark: {
    color: CONTACTS_ERROR,
    fontSize: 16,
    fontWeight: '700',
    minWidth: 16,
    marginTop: 1,
  },
  message: { color: CONTACTS_ERROR, fontSize: 14, flex: 1, flexShrink: 1 },
  detailsToggle: { minHeight: MIN_TARGET, justifyContent: 'center' },
  detailsLabel: { color: CONTACTS_MUTED, fontSize: 14, textDecorationLine: 'underline' },
  details: { color: CONTACTS_MUTED, fontSize: 13, fontFamily: 'monospace' },
  retry: { minHeight: MIN_TARGET, justifyContent: 'center' },
  retryLabel: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
});
