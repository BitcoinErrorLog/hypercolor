import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import type { PaymentReviewView } from '../ui/paymentReview';
import { modalAnimationType, useReduceMotion } from '../ui/reduceMotion';

export function PaymentReviewSheet({
  visible,
  review,
  busy,
  onClose,
  onContinue,
  onCopyUri,
}: {
  visible: boolean;
  review: PaymentReviewView;
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onCopyUri: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const primaryDisabled = busy || !review.primaryEnabled;
  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion) === 'none' ? 'none' : 'fade'}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <Pressable
          testID="paymentReviewBackdrop"
          accessibilityRole="button"
          accessibilityLabel={COPY.cancel}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View testID="paymentReviewSheet" style={styles.sheet}>
          <ScrollView>
            <Text style={styles.title}>{COPY.reviewBeforePaying}</Text>
            <Text style={styles.label}>Recipient</Text>
            <Text testID="paymentReviewRecipient" style={styles.value}>
              {review.recipientTitle}
            </Text>
            <Text testID="paymentReviewShortPubky" style={styles.mono}>
              {review.recipientShortPubky}
            </Text>
            <Text style={styles.label}>Amount</Text>
            <Text testID="paymentReviewAmount" style={styles.value}>
              {review.amountText}
            </Text>
            {review.invoiceAmountText ? (
              <Text testID="paymentReviewInvoiceAmount" style={styles.meta}>
                Invoice {review.invoiceAmountText}
              </Text>
            ) : null}
            {review.referenceText ? (
              <>
                <Text style={styles.label}>Reference</Text>
                <Text testID="paymentReviewReference" style={styles.value}>
                  {review.referenceText}
                </Text>
              </>
            ) : null}
            {review.destinationText ? (
              <>
                <Text style={styles.label}>Destination</Text>
                <Text testID="paymentReviewDestination" style={styles.mono}>
                  {review.destinationText}
                </Text>
              </>
            ) : null}
            {review.payloadText ? (
              <Text testID="paymentReviewPayload" style={styles.mono}>
                {review.payloadText}
              </Text>
            ) : null}
            {review.networkText ? (
              <Text testID="paymentReviewNetwork" style={styles.meta}>
                Network {review.networkText}
              </Text>
            ) : null}
            {review.feeText ? <Text style={styles.meta}>Fee {review.feeText}</Text> : null}
            {review.expiryText ? (
              <Text testID="paymentReviewExpiry" style={styles.meta}>
                {review.expiryText}
              </Text>
            ) : null}
            {review.warningText ? (
              <View
                testID="paymentReviewWarning"
                accessibilityRole="alert"
                style={styles.warningBox}
              >
                <Text style={styles.warningIcon}>!</Text>
                <Text style={styles.warning}>{review.warningText}</Text>
              </View>
            ) : null}
            {review.errorText ? (
              <View testID="paymentReviewError" accessibilityRole="alert" style={styles.errorBox}>
                <Text style={styles.warningIcon}>!</Text>
                <Text style={styles.error}>{review.errorText}</Text>
              </View>
            ) : null}
          </ScrollView>
          <TouchableOpacity
            testID="paymentReviewContinue"
            accessibilityRole="button"
            accessibilityLabel={review.primaryLabel}
            accessibilityHint="Opens Bitkit to complete this payment"
            accessibilityState={{ disabled: primaryDisabled, busy }}
            hitSlop={HIT_SLOP_44}
            disabled={primaryDisabled}
            onPress={onContinue}
            style={[
              styles.primary,
              review.primaryOutline && styles.primaryOutline,
              primaryDisabled && styles.disabled,
            ]}
          >
            <Text style={[styles.primaryText, review.primaryOutline && styles.primaryOutlineText]}>
              {review.primaryLabel}
            </Text>
          </TouchableOpacity>
          {review.uri && !review.walletUnavailable ? (
            <TouchableOpacity
              testID="paymentReviewCopy"
              accessibilityRole="button"
              accessibilityLabel={review.secondaryLabel}
              hitSlop={HIT_SLOP_44}
              onPress={onCopyUri}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>{review.secondaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            testID="paymentReviewCancel"
            accessibilityRole="button"
            accessibilityLabel={COPY.cancel}
            hitSlop={HIT_SLOP_44}
            onPress={onClose}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>{COPY.cancel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 10,
    maxHeight: '88%',
  },
  title: { color: '#f9fafb', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  label: { color: '#808692', fontSize: 12, fontWeight: '600', marginTop: 8 },
  value: { color: '#f9fafb', fontSize: 16, fontWeight: '600' },
  mono: { color: '#c4b5fd', fontSize: 13, fontFamily: 'monospace' },
  meta: { color: '#808692', fontSize: 13, marginTop: 4 },
  warningBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 8 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 8 },
  warningIcon: { color: '#fbbf24', fontSize: 16, fontWeight: '700' },
  warning: { flex: 1, color: '#fbbf24', fontSize: 13, lineHeight: 18 },
  error: { flex: 1, color: '#fca5a5', fontSize: 13, lineHeight: 18 },
  primary: {
    minHeight: 44,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#7c3aed',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  primaryOutlineText: { color: '#c4b5fd' },
  disabled: { opacity: 0.4 },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#8f57f0', fontSize: 15, fontWeight: '600' },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#808692', fontSize: 15, fontWeight: '600' },
});
