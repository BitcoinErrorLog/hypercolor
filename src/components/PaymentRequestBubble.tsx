import React, { useCallback, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { PaymentRequestCard, useTickingNow } from './PaymentRequestCard';
import { PaymentService } from '../services/payments/PaymentService';
import { openBuiltUri, prepareRequestHandoff } from '../services/payments/walletHandoff';
import { PaymentError, type PaymentRequestRecord, type TipEndpointRecord } from '../types/payment';
import { formatTipIdentifierDisplay, payloadPreview } from '../utils/displaySanitize';

export function PaymentRequestBubble({
  record,
  localPubky: _localPubky,
  onChanged,
}: {
  record: PaymentRequestRecord;
  localPubky: string;
  onChanged: () => void;
}) {
  const nowMs = useTickingNow();
  const [busy, setBusy] = useState(false);
  const [proofDraft, setProofDraft] = useState('');
  const [destinations, setDestinations] = useState<TipEndpointRecord[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffWarning, setHandoffWarning] = useState<string | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState<string | null>(null);
  const isPayee = record.direction === 'sent';

  const run = useCallback(
    async (body: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await body();
        onChanged();
      } catch (err) {
        const message =
          err instanceof PaymentError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Payment action failed';
        Alert.alert('Payment', message);
      } finally {
        setBusy(false);
      }
    },
    [busy, onChanged],
  );

  const selected = destinations?.find(row => row.identifier === selectedId) ?? null;
  const preview = selected
    ? prepareRequestHandoff({
        requestAmountBtc: record.amountValue,
        endpointIdentifier: selected.identifier,
        payload: selected.payload,
      })
    : null;

  return (
    <View>
      <PaymentRequestCard
        record={record}
        isPayee={isPayee}
        nowMs={nowMs}
        busy={busy}
        proofDraft={proofDraft}
        onChangeProofDraft={setProofDraft}
        onAccept={() => {
          void run(() =>
            PaymentService.acceptRequest(record.peerPubky, record.paymentRequestId).then(
              () => undefined,
            ),
          );
        }}
        onReject={() => {
          void run(() =>
            PaymentService.rejectRequest(record.peerPubky, record.paymentRequestId).then(
              () => undefined,
            ),
          );
        }}
        onCancel={() => {
          void run(() =>
            PaymentService.cancelRequest(record.peerPubky, record.paymentRequestId).then(
              () => undefined,
            ),
          );
        }}
        onPayInWallet={() => {
          void run(async () => {
            const matches = await PaymentService.listMatchingTipEndpoints(
              record.peerPubky,
              record.endpointIds,
            );
            if (matches.length === 0) {
              throw new PaymentError(
                'not-found',
                'No matching destination from this peer for this request',
              );
            }
            setDestinations(matches);
            setSelectedId(null);
            setHandoffError(null);
            setHandoffWarning(null);
            setInvoiceAmount(null);
          });
        }}
        onSubmitProof={() => {
          void run(() =>
            PaymentService.submitProofManual(
              record.peerPubky,
              record.paymentRequestId,
              proofDraft,
            ).then(() => undefined),
          );
        }}
      />
      {destinations ? (
        <View style={styles.picker}>
          <Text style={styles.pickerTitle}>Choose destination</Text>
          <Text style={styles.amountRow}>
            Request {record.amountValue} {record.amountAsset.toUpperCase()}
            {invoiceAmount !== null ? ` · Invoice ${invoiceAmount} BTC` : ''}
          </Text>
          {destinations.map(endpoint => (
            <TouchableOpacity
              key={endpoint.identifier}
              style={[
                styles.destination,
                selectedId === endpoint.identifier ? styles.destinationSelected : null,
              ]}
              onPress={() => {
                const next = prepareRequestHandoff({
                  requestAmountBtc: record.amountValue,
                  endpointIdentifier: endpoint.identifier,
                  payload: endpoint.payload,
                });
                setSelectedId(endpoint.identifier);
                setInvoiceAmount(next.invoiceAmountBtc);
                if (next.ok) {
                  setHandoffError(null);
                  setHandoffWarning(next.warning ?? null);
                } else {
                  setHandoffError(next.error);
                  setHandoffWarning(null);
                }
              }}
            >
              <Text style={styles.destinationId}>
                {formatTipIdentifierDisplay(endpoint.identifier)}
              </Text>
              <Text style={styles.destinationPayload}>{payloadPreview(endpoint.payload)}</Text>
            </TouchableOpacity>
          ))}
          {handoffError ? <Text style={styles.error}>{handoffError}</Text> : null}
          {handoffWarning ? <Text style={styles.warning}>{handoffWarning}</Text> : null}
          <TouchableOpacity
            style={[styles.openWallet, (!preview || !preview.ok || busy) && styles.disabled]}
            disabled={!preview || !preview.ok || busy}
            onPress={() => {
              if (!preview || !preview.ok || !selected) return;
              void run(async () => {
                if (preview.paymentHash) {
                  await PaymentService.recordDisplayedInvoice(
                    record.peerPubky,
                    record.paymentRequestId,
                    preview.paymentHash,
                  );
                }
                await openBuiltUri(preview.uri);
                setDestinations(null);
              });
            }}
          >
            <Text style={styles.openWalletText}>Open wallet</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { marginTop: 8, gap: 6 },
  pickerTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  amountRow: { color: '#fff', fontSize: 12, fontWeight: '600' },
  destination: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  destinationSelected: { borderWidth: 1, borderColor: '#a78bfa' },
  destinationId: { color: '#f9fafb', fontSize: 12, fontFamily: 'monospace' },
  destinationPayload: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: 'monospace' },
  error: { color: '#fca5a5', fontSize: 12 },
  warning: { color: '#fbbf24', fontSize: 12 },
  openWallet: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  openWalletText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
