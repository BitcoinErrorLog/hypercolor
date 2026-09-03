import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  ScrollView,
  AccessibilityInfo,
  findNodeHandle,
} from 'react-native';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import type { PaymentReviewView } from '../ui/paymentReview';
import { modalAnimationType, useReduceMotion } from '../ui/reduceMotion';
import { color, space, radius, typeRole, measure } from '../theme';

export function PaymentReviewSheet({
  visible,
  review,
  busy,
  onClose,
  onContinue,
  onCopyUri,
  onSelectDestination,
}: {
  visible: boolean;
  review: PaymentReviewView;
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onCopyUri: () => void;
  onSelectDestination?: (identifier: string) => void;
}) {
  const reduceMotion = useReduceMotion();
  const titleRef = useRef<Text>(null);
  const primaryDisabled = busy || !review.primaryEnabled;

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const tag = findNodeHandle(titleRef.current);
      if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
    }, 50);
    return () => clearTimeout(timer);
  }, [visible]);

  function handlePrimary() {
    if (primaryDisabled) return;
    if (review.primaryAction === 'copy') onCopyUri();
    else onContinue();
  }

  function handleSecondary() {
    if (review.secondaryAction === 'open') onContinue();
    else onCopyUri();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion, 'fade')}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View testID="paymentReviewSheet" style={styles.sheet}>
          <ScrollView>
            <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
              {COPY.reviewBeforePaying}
            </Text>
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
            {review.destinations.length > 1 ? (
              <>
                <Text style={styles.label}>{COPY.choosePaymentDestination}</Text>
                {review.destinations.map(option => {
                  const selected = option.identifier === review.selectedIdentifier;
                  return (
                    <TouchableOpacity
                      key={option.identifier}
                      testID={`paymentReviewDestination-${option.identifier}`}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected, disabled: busy }}
                      hitSlop={HIT_SLOP_44}
                      onPress={() => onSelectDestination?.(option.identifier)}
                      style={[styles.choice, selected && styles.choiceOn]}
                    >
                      <Text style={styles.mono}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            ) : review.destinationText ? (
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
            accessibilityHint={
              review.primaryAction === 'copy'
                ? 'Copies the payment URI'
                : 'Opens the wallet to complete this payment'
            }
            accessibilityState={{ disabled: primaryDisabled, busy }}
            hitSlop={HIT_SLOP_44}
            disabled={primaryDisabled}
            onPress={handlePrimary}
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
          {review.secondaryLabel ? (
            <TouchableOpacity
              testID="paymentReviewCopy"
              accessibilityRole="button"
              accessibilityLabel={review.secondaryLabel}
              hitSlop={HIT_SLOP_44}
              onPress={handleSecondary}
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
        <Pressable
          testID="paymentReviewBackdrop"
          accessible={false}
          style={styles.backdropHit}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: color.overlay,
    justifyContent: 'flex-end',
  },
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: space.xl,
    gap: space.md,
    maxHeight: '88%',
    zIndex: 1,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.numeric.fontSize,
    fontWeight: '700',
    marginBottom: space.sm,
  },
  label: {
    color: color.textSecondary,
    fontSize: typeRole.meta.fontSize,
    fontWeight: '600',
    marginTop: space.sm,
  },
  value: { color: color.textPrimary, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  mono: { color: color.brandMuted, fontSize: typeRole.caption.fontSize, fontFamily: 'monospace' },
  meta: { color: color.textSecondary, fontSize: typeRole.caption.fontSize, marginTop: space.xs },
  choice: {
    minHeight: measure.hitTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    marginTop: space.sm,
  },
  choiceOn: { borderColor: color.brand, backgroundColor: color.surfaceBrand },
  warningBox: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    marginTop: space.sm,
  },
  errorBox: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.sm },
  warningIcon: { color: color.warningStrong, fontSize: typeRole.body.fontSize, fontWeight: '700' },
  warning: {
    flex: 1,
    color: color.warningStrong,
    fontSize: typeRole.caption.fontSize,
    lineHeight: 18,
  },
  error: { flex: 1, color: color.danger, fontSize: typeRole.caption.fontSize, lineHeight: 18 },
  primary: {
    minHeight: measure.hitTarget,
    backgroundColor: color.brand,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  primaryOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: color.brand,
  },
  primaryText: { color: color.textOnBrand, fontSize: typeRole.body.fontSize, fontWeight: '700' },
  primaryOutlineText: { color: color.brandMuted },
  disabled: { opacity: 0.4 },
  secondary: { minHeight: measure.hitTarget, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: color.brandText, fontSize: typeRole.callout.fontSize, fontWeight: '600' },
  cancel: { minHeight: measure.hitTarget, alignItems: 'center', justifyContent: 'center' },
  cancelText: {
    color: color.textSecondary,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
