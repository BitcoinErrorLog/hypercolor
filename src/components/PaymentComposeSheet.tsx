import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { isPositiveBtcAmount, isValidPaymentReference, btcDecimalToSats } from '../types/payment';
import { COPY, amountSatsApprox } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { PAYMENT_COMPOSE_DEFAULT_AMOUNT } from '../ui/paymentReview';
import { modalAnimationType, useReduceMotion } from '../ui/reduceMotion';
import { color, space, radius, typeRole, measure } from '../theme';

export function paymentComposeError(
  amount: string,
  reference: string,
  intent: 'request' | 'tip' = 'request',
): string | null {
  const amountValue = amount.trim();
  const referenceValue = reference.trim();
  if (!isPositiveBtcAmount(amountValue)) {
    return 'Enter a valid BTC amount';
  }
  if (intent === 'tip') return null;
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
  intent = 'request',
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  intent?: 'request' | 'tip';
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

  const canSubmit = paymentComposeError(amount, reference, intent) === null;
  const sats = btcDecimalToSats(amount);

  function handleSubmit() {
    const amountValue = amount.trim();
    const referenceValue = reference.trim();
    const message = paymentComposeError(amountValue, referenceValue, intent);
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
          <Text style={styles.title}>
            {intent === 'tip' ? COPY.tipAmountTitle : 'Request payment'}
          </Text>
          <Text style={styles.label}>Amount (BTC)</Text>
          <TextInput
            testID="paymentComposeAmount"
            accessibilityLabel="Payment amount in BTC"
            style={styles.input}
            value={amount}
            onChangeText={handleAmountChange}
            keyboardType="decimal-pad"
            placeholder="Amount"
            placeholderTextColor={color.textSecondary}
            autoCapitalize="none"
          />
          {sats !== null ? (
            <Text testID="paymentComposeSats" style={styles.satsHint}>
              {amountSatsApprox(sats)}
            </Text>
          ) : null}
          {intent === 'request' ? (
            <>
              <Text style={styles.label}>Reference</Text>
              <TextInput
                testID="paymentComposeReference"
                accessibilityLabel="Payment reference"
                style={styles.input}
                value={reference}
                onChangeText={handleReferenceChange}
                placeholder="invoice-2026-0001"
                placeholderTextColor={color.textSecondary}
                autoCapitalize="none"
              />
            </>
          ) : null}
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
              accessibilityLabel={COPY.cancel}
              style={styles.secondary}
              hitSlop={HIT_SLOP_44}
              onPress={onClose}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>{COPY.cancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="paymentComposeSubmit"
              accessibilityRole="button"
              accessibilityLabel={intent === 'tip' ? COPY.continueToReview : 'Send request'}
              accessibilityState={{ disabled: busy || !canSubmit, busy }}
              style={[styles.primary, (busy || !canSubmit) && styles.disabled]}
              hitSlop={HIT_SLOP_44}
              onPress={handleSubmit}
              disabled={busy || !canSubmit}
            >
              <Text style={styles.primaryText}>
                {intent === 'tip' ? COPY.continueToReview : 'Send request'}
              </Text>
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
    backgroundColor: color.overlay,
    justifyContent: 'center',
    padding: space.xxl,
  },
  sheet: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.titleStack.fontSize,
    fontWeight: '700',
    marginBottom: space.xs,
  },
  label: { color: color.textMuted, fontSize: typeRole.meta.fontSize, fontWeight: '600' },
  satsHint: { color: color.textSecondary, fontSize: typeRole.caption.fontSize },
  validation: { color: color.warning, fontSize: typeRole.caption.fontSize, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  errorIcon: { color: color.warning, fontSize: typeRole.secondary.fontSize, fontWeight: '700' },
  input: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    color: color.textPrimary,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: typeRole.callout.fontSize,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.md, marginTop: space.sm },
  secondary: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    justifyContent: 'center',
  },
  secondaryText: { color: color.textMuted, fontSize: typeRole.callout.fontSize },
  primary: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    justifyContent: 'center',
  },
  primaryText: { color: color.textOnBrand, fontSize: typeRole.callout.fontSize, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
