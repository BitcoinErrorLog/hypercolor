import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  type TipEndpointRecord,
} from '../types/payment';
import { HIT_SLOP_44 } from '../ui/hitTarget';

export function TipEndpointsForm({
  endpoints,
  busy,
  error,
  onSave,
}: {
  endpoints: TipEndpointRecord[];
  busy: boolean;
  error: string | null;
  onSave: (bolt11: string, address: string) => void;
}) {
  const existingBolt11 =
    endpoints.find(row => row.identifier === ENDPOINT_LIGHTNING_BOLT11)?.payload ?? '';
  const existingOnchain =
    endpoints.find(row => row.identifier === ENDPOINT_BITCOIN_P2TR)?.payload ?? '';
  const [bolt11, setBolt11] = useState(existingBolt11);
  const [address, setAddress] = useState(existingOnchain);

  return (
    <View>
      <Text style={styles.hint}>
        Shared privately over Encrypted Links. This app never pays — wallets open via lightning: or
        bitcoin: links after validation.
      </Text>
      <Text style={styles.label}>Bolt11 invoice</Text>
      <TextInput
        style={styles.input}
        value={bolt11}
        onChangeText={setBolt11}
        placeholder="lnbc1…"
        placeholderTextColor="#4b5563"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>On-chain address</Text>
      <TextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        placeholder="bc1p…"
        placeholderTextColor="#4b5563"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error ? (
        <View accessibilityRole="alert" accessibilityLabel={error} style={styles.errorRow}>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Save"
        accessibilityState={{ disabled: busy, busy }}
        hitSlop={HIT_SLOP_44}
        style={[styles.save, busy && styles.disabled]}
        onPress={() => onSave(bolt11.trim(), address.trim())}
        disabled={busy}
      >
        <Text style={styles.saveText}>Save</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: '#6b7280', paddingHorizontal: 20, marginBottom: 10 },
  label: {
    fontSize: 12,
    color: '#9ca3af',
    paddingHorizontal: 20,
    marginBottom: 6,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    color: '#f9fafb',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  error: { color: '#fca5a5', fontSize: 12, flex: 1 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  errorIcon: { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
  save: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    marginHorizontal: 20,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
