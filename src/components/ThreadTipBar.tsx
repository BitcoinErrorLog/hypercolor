import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { TipEndpointRecord } from '../types/payment';
import { useTickingNow } from './PaymentRequestCard';
import { formatTipIdentifierDisplay } from '../utils/displaySanitize';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';

/** Endpoint list for Send a tip. Chip row removed — entry is the composer menu. */
export function ThreadTipBarContent({
  endpoints,
  onTip,
}: {
  endpoints: TipEndpointRecord[];
  onTip: (identifier: string) => void;
}) {
  const nowMs = useTickingNow();
  const payable = endpoints.filter(endpoint => endpoint.validationStatus !== 'rejected');

  if (payable.length === 0) {
    return (
      <View testID="tipDestinationList" style={styles.wrap}>
        <Text style={styles.empty}>{COPY.noTipDestinations}</Text>
      </View>
    );
  }

  return (
    <View testID="tipDestinationList" style={styles.wrap}>
      {payable.map(endpoint => {
        const expired = endpoint.invoiceExpiresAt !== null && endpoint.invoiceExpiresAt <= nowMs;
        return (
          <TouchableOpacity
            key={endpoint.identifier}
            accessibilityRole="button"
            accessibilityLabel={`Pay ${formatTipIdentifierDisplay(endpoint.identifier)}`}
            accessibilityState={{ disabled: expired }}
            hitSlop={HIT_SLOP_44}
            style={styles.endpoint}
            onPress={() => onTip(endpoint.identifier)}
            disabled={expired}
          >
            <View style={styles.endpointCopy}>
              <Text style={styles.endpointId}>
                {formatTipIdentifierDisplay(endpoint.identifier)}
              </Text>
              {endpoint.invoiceAmount ? (
                <Text style={styles.meta}>{endpoint.invoiceAmount} BTC</Text>
              ) : null}
              {expired ? <Text style={styles.expired}>{COPY.invoiceExpired}</Text> : null}
              {endpoint.invoiceExpiresAt !== null && !expired ? (
                <Text style={styles.meta}>
                  Expires {new Date(endpoint.invoiceExpiresAt).toISOString()}
                </Text>
              ) : null}
            </View>
            <Text style={styles.endpointHint}>{COPY.continueInBitkit}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  empty: { color: '#808692', fontSize: 13, paddingHorizontal: 4 },
  endpoint: {
    backgroundColor: '#141414',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  endpointCopy: { flex: 1, gap: 2, paddingRight: 8 },
  endpointId: { color: '#f9fafb', fontSize: 12, fontFamily: 'monospace' },
  endpointHint: { color: '#a78bfa', fontSize: 12, fontWeight: '600' },
  meta: { color: '#9ca3af', fontSize: 11 },
  expired: { color: '#fca5a5', fontSize: 11, fontWeight: '600' },
});

export const ThreadTipBar = ThreadTipBarContent;
