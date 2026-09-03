import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  type TipEndpointRecord,
} from '../types/payment';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { color, space, radius, typeRole, measure } from '../theme';

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
        placeholderTextColor={color.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>On-chain address</Text>
      <TextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        placeholder="bc1p…"
        placeholderTextColor={color.textSecondary}
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
  hint: { fontSize: typeRole.meta.fontSize, color: color.textSecondary, paddingHorizontal: space.xl, marginBottom: space.md },
  label: {
    fontSize: typeRole.meta.fontSize,
    color: color.textMuted,
    paddingHorizontal: space.xl,
    marginBottom: space.sm,
    fontWeight: '600',
  },
  input: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    color: color.textPrimary,
    marginHorizontal: space.xl,
    marginBottom: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: typeRole.caption.fontSize,
    fontFamily: 'monospace',
  },
  error: { color: color.danger, fontSize: typeRole.meta.fontSize, flex: 1 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.xl,
    marginBottom: space.sm,
  },
  errorIcon: { color: color.danger, fontSize: typeRole.meta.fontSize, fontWeight: '700' },
  save: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    marginHorizontal: space.xl,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: color.textOnBrand, fontSize: typeRole.callout.fontSize, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
