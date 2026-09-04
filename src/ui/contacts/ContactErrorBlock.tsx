import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CONTACTS_ERROR, CONTACTS_MUTED, MIN_TARGET } from './tokens';
import { color, space, typeRole } from '../../theme';

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
  wrap: { gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  mark: {
    color: CONTACTS_ERROR,
    fontSize: typeRole.body.fontSize,
    fontWeight: '700',
    minWidth: 16,
    marginTop: 1,
  },
  message: { color: CONTACTS_ERROR, fontSize: typeRole.secondary.fontSize, flex: 1, flexShrink: 1 },
  detailsToggle: { minHeight: MIN_TARGET, justifyContent: 'center' },
  detailsLabel: {
    color: CONTACTS_MUTED,
    fontSize: typeRole.secondary.fontSize,
    textDecorationLine: 'underline',
  },
  details: { color: CONTACTS_MUTED, fontSize: typeRole.caption.fontSize, fontFamily: 'monospace' },
  retry: { minHeight: MIN_TARGET, justifyContent: 'center' },
  retryLabel: { color: color.brandText, fontSize: typeRole.body.fontSize, fontWeight: '600' },
});
