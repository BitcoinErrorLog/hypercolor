import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import type { TipEndpointRecord } from '../types/payment';
import { PaymentError } from '../types/payment';
import { PaymentService } from '../services/payments/PaymentService';
import { openPayUri } from '../services/payments/walletHandoff';
import { useTickingNow } from './PaymentRequestCard';
import { formatTipIdentifierDisplay } from '../utils/displaySanitize';

export function ThreadTipBar({
  peerPubky,
  endpoints,
  onChanged,
}: {
  peerPubky: string;
  endpoints: TipEndpointRecord[];
  onChanged: () => void;
}) {
  return (
    <ThreadTipBarContent
      endpoints={endpoints}
      onTip={identifier => {
        const match = endpoints.find(row => row.identifier === identifier);
        if (!match) return;
        void openPayUri(match.identifier, match.payload).catch(err => {
          Alert.alert('Tip', err instanceof Error ? err.message : 'Could not open wallet');
        });
      }}
      onSendMyList={() => {
        void PaymentService.sendTipList(peerPubky)
          .then(onChanged)
          .catch(err => {
            const message =
              err instanceof PaymentError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Could not send tip list';
            Alert.alert('Tip list', message);
          });
      }}
    />
  );
}

export function ThreadTipBarContent({
  endpoints,
  onTip,
  onSendMyList,
}: {
  endpoints: TipEndpointRecord[];
  onTip: (identifier: string) => void;
  onSendMyList: () => void;
}) {
  const [open, setOpen] = useState(false);
  const nowMs = useTickingNow();
  const toggle = useCallback(() => setOpen(value => !value), []);
  const payable = endpoints.filter(endpoint => endpoint.validationStatus !== 'rejected');

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TouchableOpacity onPress={toggle} style={styles.chip}>
          <Text style={styles.chipText}>Tip{payable.length > 0 ? ` (${payable.length})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSendMyList} style={styles.chip}>
          <Text style={styles.chipText}>Send my tip list</Text>
        </TouchableOpacity>
      </View>
      {open ? (
        payable.length === 0 ? (
          <Text style={styles.empty}>No tip destinations from this peer yet.</Text>
        ) : (
          payable.map(endpoint => {
            const expired =
              endpoint.invoiceExpiresAt !== null && endpoint.invoiceExpiresAt <= nowMs;
            return (
              <TouchableOpacity
                key={endpoint.identifier}
                style={styles.endpoint}
                onPress={() => onTip(endpoint.identifier)}
              >
                <View style={styles.endpointCopy}>
                  <Text style={styles.endpointId}>
                    {formatTipIdentifierDisplay(endpoint.identifier)}
                  </Text>
                  {endpoint.invoiceAmount ? (
                    <Text style={styles.meta}>{endpoint.invoiceAmount} BTC</Text>
                  ) : null}
                  {expired ? <Text style={styles.expired}>Expired</Text> : null}
                  {endpoint.invoiceExpiresAt !== null && !expired ? (
                    <Text style={styles.meta}>
                      Expires {new Date(endpoint.invoiceExpiresAt).toISOString()}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.endpointHint}>Pay in wallet</Text>
              </TouchableOpacity>
            );
          })
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: '#1f1f1f',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { color: '#e9d5ff', fontSize: 12, fontWeight: '600' },
  empty: { color: '#6b7280', fontSize: 12, paddingHorizontal: 4 },
  endpoint: {
    backgroundColor: '#141414',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
