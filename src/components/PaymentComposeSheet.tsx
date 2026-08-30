import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal } from 'react-native';

export function PaymentComposeSheet({
  visible,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amountBtc: string, reference: string) => void;
}) {
  const [amount, setAmount] = useState('0.001');
  const [reference, setReference] = useState('');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Request payment</Text>
          <Text style={styles.label}>Amount (BTC)</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.001"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
          />
          <Text style={styles.label}>Reference</Text>
          <TextInput
            style={styles.input}
            value={reference}
            onChangeText={setReference}
            placeholder="invoice-2026-0001"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
          />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondary} onPress={onClose} disabled={busy}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primary, busy && styles.disabled]}
              onPress={() => onSubmit(amount.trim(), reference.trim())}
              disabled={busy}
            >
              <Text style={styles.primaryText}>Send request</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: { backgroundColor: '#111', borderRadius: 16, padding: 20, gap: 10 },
  title: { color: '#f9fafb', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  label: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    color: '#f9fafb',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  secondary: { paddingHorizontal: 12, paddingVertical: 10 },
  secondaryText: { color: '#9ca3af', fontSize: 15 },
  primary: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
