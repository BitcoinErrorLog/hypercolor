import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { TipEndpointRecord } from '../types/payment';
import { useTickingNow } from './PaymentRequestCard';
import { formatTipIdentifierDisplay } from '../utils/displaySanitize';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { color, space, radius, typeRole, measure } from '../theme';

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
            <Text style={styles.endpointHint}>{COPY.openWallet}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  empty: {
    color: color.textSecondary,
    fontSize: typeRole.caption.fontSize,
    paddingHorizontal: space.xs,
  },
  endpoint: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  endpointCopy: { flex: 1, gap: 2, paddingRight: space.sm },
  endpointId: {
    color: color.textPrimary,
    fontSize: typeRole.meta.fontSize,
    fontFamily: 'monospace',
  },
  endpointHint: { color: color.brandSoft, fontSize: typeRole.meta.fontSize, fontWeight: '600' },
  meta: { color: color.textMuted, fontSize: typeRole.meta.fontSize },
  expired: { color: color.danger, fontSize: typeRole.meta.fontSize, fontWeight: '600' },
});
