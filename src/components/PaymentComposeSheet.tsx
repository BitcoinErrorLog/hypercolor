import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { isPositiveBtcAmount, isValidPaymentReference } from '../types/payment';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { PAYMENT_COMPOSE_DEFAULT_AMOUNT } from '../ui/paymentReview';
import { modalAnimationType, useReduceMotion } from '../ui/reduceMotion';

export function paymentComposeError(amount: string, reference: string): string | null {
  const amountValue = amount.trim();
  const referenceValue = reference.trim();
  if (!isPositiveBtcAmount(amountValue)) {
    return 'Enter a valid BTC amount';
  }
  if (referenceValue.length === 0) {
    return 'Enter a payment reference';
  }
  if (!isValidPaymentReference(referenceValue)) {
    return 'Payment reference is invalid';
  }
  return null;
}

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
  const reduceMotion = useReduceMotion();
  const [amount, setAmount] = useState(PAYMENT_COMPOSE_DEFAULT_AMOUNT);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleAmountChange(value: string) {
    setAmount(value);
    setError(null);
  }

  function handleReferenceChange(value: string) {
    setReference(value);
    setError(null);
  }

  function handleSubmit() {
    const amountValue = amount.trim();
    const referenceValue = reference.trim();
    const message = paymentComposeError(amountValue, referenceValue);
    if (message) {
      setError(message);
      return;
    }
    onSubmit(amountValue, referenceValue);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion, 'fade')}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View testID="paymentComposeSheet" style={styles.sheet}>
          <Text style={styles.title}>Request payment</Text>
          <Text style={styles.label}>Amount (BTC)</Text>
          <TextInput
            testID="paymentComposeAmount"
            accessibilityLabel="Payment amount in BTC"
            style={styles.input}
            value={amount}
            onChangeText={handleAmountChange}
            keyboardType="decimal-pad"
            placeholder="Amount"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
          />
          <Text style={styles.label}>Reference</Text>
          <TextInput
            testID="paymentComposeReference"
            accessibilityLabel="Payment reference"
            style={styles.input}
            value={reference}
            onChangeText={handleReferenceChange}
            placeholder="invoice-2026-0001"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
          />
          {error ? (
            <View
              testID="paymentComposeError"
              accessibilityRole="alert"
              accessibilityLabel={error}
              style={styles.errorRow}
            >
              <Text style={styles.errorIcon}>!</Text>
              <Text style={styles.validation}>{error}</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <TouchableOpacity
              testID="paymentComposeCancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel payment request"
              style={styles.secondary}
              hitSlop={HIT_SLOP_44}
              onPress={onClose}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="paymentComposeSubmit"
              accessibilityRole="button"
              accessibilityLabel="Send request"
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.primary, busy && styles.disabled]}
              hitSlop={HIT_SLOP_44}
              onPress={handleSubmit}
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
  validation: { color: '#f59e0b', fontSize: 13, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorIcon: { color: '#f59e0b', fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    color: '#f9fafb',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  secondary: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryText: { color: '#9ca3af', fontSize: 15 },
  primary: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
