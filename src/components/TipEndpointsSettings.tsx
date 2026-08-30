import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TipEndpointsForm } from './TipEndpointsForm';
import { PaymentService } from '../services/payments/PaymentService';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  PaymentError,
  type TipEndpointRecord,
} from '../types/payment';

export function TipEndpointsSettings() {
  const [endpoints, setEndpoints] = useState<TipEndpointRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const rows = await PaymentService.getMyTipEndpoints();
    setEndpoints(rows);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload().catch(() => setLoaded(true));
  }, [reload]);

  const handleSave = useCallback(async (bolt11: string, address: string) => {
    setBusy(true);
    setError(null);
    try {
      const next: { identifier: string; payload: string }[] = [];
      if (bolt11.length > 0) {
        next.push({ identifier: ENDPOINT_LIGHTNING_BOLT11, payload: bolt11 });
      }
      if (address.length > 0) {
        next.push({ identifier: ENDPOINT_BITCOIN_P2TR, payload: address });
      }
      const saved = await PaymentService.setMyTipEndpoints(next);
      setEndpoints(saved);
    } catch (err) {
      setError(
        err instanceof PaymentError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not save tip endpoints',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (!loaded) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>My tip endpoints</Text>
      <TipEndpointsForm endpoints={endpoints} busy={busy} error={error} onSave={handleSave} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
});
