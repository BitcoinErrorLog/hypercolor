import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { formatPaymentDisplayText, type PaymentRequestRecord } from '../types/payment';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { formatPaymentReceipt } from '../ui/paymentReceiptStatus';

export function PaymentRequestCard({
  record,
  isPayee,
  nowMs,
  busy,
  proofDraft,
  onChangeProofDraft,
  onAccept,
  onReject,
  onCancel,
  onPayInWallet,
  onSubmitProof,
}: {
  record: PaymentRequestRecord;
  isPayee: boolean;
  nowMs: number;
  busy: boolean;
  proofDraft: string;
  onChangeProofDraft: (value: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
  onPayInWallet: () => void;
  onSubmitProof: () => void;
}) {
  const receipt = formatPaymentReceipt(record, nowMs);
  const statusWord = receipt.word;
  const isPayer = !isPayee;

  return (
    <View testID="paymentRequestCard" style={styles.card}>
      <Text style={styles.title}>Payment request</Text>
      <Text testID="paymentRequestAmount" style={styles.amount}>
        {record.amountValue} {record.amountAsset.toUpperCase()}
      </Text>
      <Text style={styles.reference}>{formatPaymentDisplayText(record.paymentReference)}</Text>
      <View style={styles.chipRow}>
        <StatusChip status={statusWord} />
        {record.expiresAt !== null ? (
          <ExpiryLabel expiresAt={record.expiresAt} nowMs={nowMs} />
        ) : null}
      </View>
      {receipt.note ? (
        <Text testID="paymentRequestProofNote" style={styles.reference}>
          {receipt.note}
        </Text>
      ) : null}
      {record.pendingEventId !== null ? (
        <View
          testID="paymentRequestSending"
          accessibilityRole="progressbar"
          accessibilityLabel={COPY.paymentSending}
          style={styles.sendingRow}
        >
          <ActivityIndicator color="#fff" />
          <Text style={styles.sendingText}>{COPY.paymentSending}</Text>
        </View>
      ) : null}
      {isPayer &&
      record.status === 'pending' &&
      statusWord === COPY.paymentRequested &&
      record.pendingEventId === null ? (
        <View style={styles.actions}>
          <ActionButton label="Accept" onPress={onAccept} disabled={busy} primary />
          <ActionButton label="Reject" onPress={onReject} disabled={busy} />
        </View>
      ) : null}
      {isPayer && record.status === 'accepted' ? (
        <View style={styles.actionsColumn}>
          <ActionButton label="Pay in wallet" onPress={onPayInWallet} disabled={busy} primary />
          <TextInput
            style={styles.proofInput}
            value={proofDraft}
            onChangeText={onChangeProofDraft}
            placeholder="Preimage (optional)"
            placeholderTextColor="rgba(255,255,255,0.4)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ActionButton label="I paid" onPress={onSubmitProof} disabled={busy} />
        </View>
      ) : null}
      {isPayee && (record.status === 'pending' || record.status === 'accepted') ? (
        <View style={styles.actions}>
          <ActionButton label="Cancel" onPress={onCancel} disabled={busy} />
        </View>
      ) : null}
    </View>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <View
      testID="paymentRequestStatus"
      accessibilityRole="text"
      accessibilityLabel={status}
      style={[styles.chip, chipTone(status)]}
    >
      <Text style={styles.chipText}>{status}</Text>
    </View>
  );
}

function ExpiryLabel({ expiresAt, nowMs }: { expiresAt: number; nowMs: number }) {
  const remaining = expiresAt - nowMs;
  if (remaining <= 0) {
    return <Text style={styles.expiry}>Expired</Text>;
  }
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const label = minutes >= 1 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
  return <Text style={styles.expiry}>Expires in {label}</Text>;
}

function ActionButton({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={HIT_SLOP_44}
      style={[
        styles.btn,
        primary ? styles.btnPrimary : styles.btnGhost,
        disabled && styles.btnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function chipTone(status: string) {
  switch (status) {
    case COPY.paymentPaid:
      return styles.chipOk;
    case COPY.paymentFailed:
    case COPY.paymentExpired:
      return styles.chipBad;
    default:
      return styles.chipPending;
  }
}

export function useTickingNow(intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

const styles = StyleSheet.create({
  card: { minWidth: 180, gap: 6 },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
  },
  amount: { fontSize: 18, fontWeight: '700', color: '#fff' },
  reference: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipPending: { backgroundColor: 'rgba(250,204,21,0.2)' },
  chipOk: { backgroundColor: 'rgba(74,222,128,0.2)' },
  chipBad: { backgroundColor: 'rgba(248,113,113,0.2)' },
  chipText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  expiry: { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionsColumn: { gap: 8, marginTop: 4 },
  btn: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: 'rgba(255,255,255,0.18)' },
  btnGhost: { backgroundColor: 'rgba(0,0,0,0.25)' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  proofInput: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  sendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, minHeight: 44 },
  sendingText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
});
