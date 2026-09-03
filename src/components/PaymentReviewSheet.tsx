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
import { Avatar, Button, DetailRow, PubkyChip } from '../ui/primitives';

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
            <Text style={styles.label}>Amount</Text>
            <Text testID="paymentReviewAmount" style={styles.amount}>
              {review.amountText}
            </Text>
            {review.invoiceAmountText ? (
              <Text testID="paymentReviewInvoiceAmount" style={styles.meta}>
                Invoice {review.invoiceAmountText}
              </Text>
            ) : null}
            <View style={styles.recipientRow}>
              <Avatar name={review.recipientTitle} pubky={review.recipientPubky} size="md" />
              <View style={styles.recipientCopy}>
                <Text testID="paymentReviewRecipient" style={styles.value}>
                  {review.recipientTitle}
                </Text>
                <PubkyChip pubky={review.recipientPubky} testID="paymentReviewShortPubky" />
              </View>
            </View>
            {review.referenceText ? (
              <DetailRow
                label="Reference"
                value={review.referenceText}
                testID="paymentReviewReference"
              />
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
                <DetailRow
                  label="Destination"
                  value={
                    <Text testID="paymentReviewDestination" style={styles.mono}>
                      {review.destinationText}
                    </Text>
                  }
                />
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
          <Button
            testID="paymentReviewContinue"
            accessibilityLabel={review.primaryLabel}
            accessibilityHint={
              review.primaryAction === 'copy'
                ? 'Copies the payment URI'
                : 'Opens the wallet to complete this payment'
            }
            label={review.primaryLabel}
            variant={review.primaryOutline ? 'secondary' : 'primary'}
            disabled={primaryDisabled}
            busy={busy}
            onPress={handlePrimary}
            style={styles.actionButton}
          />
          {review.secondaryLabel ? (
            <Button
              testID="paymentReviewCopy"
              accessibilityLabel={review.secondaryLabel}
              label={review.secondaryLabel}
              variant="secondary"
              onPress={handleSecondary}
              style={styles.actionButton}
            />
          ) : null}
          <Button
            testID="paymentReviewCancel"
            label={COPY.cancel}
            variant="secondary"
            onPress={onClose}
            style={styles.actionButton}
          />
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
  amount: {
    color: color.textPrimary,
    fontSize: typeRole.display.fontSize,
    lineHeight: typeRole.display.lineHeight,
    fontWeight: typeRole.display.fontWeight,
    marginBottom: space.lg,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  recipientCopy: { flex: 1, gap: space.xs },
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
  actionButton: { marginTop: space.sm },
});
