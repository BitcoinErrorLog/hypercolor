import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { PaymentRequestCard, useTickingNow } from './PaymentRequestCard';
import { PaymentService } from '../services/payments/PaymentService';
import { type PaymentRequestRecord, type TipEndpointRecord } from '../types/payment';
import { COPY } from '../copy/uxCopy';
import { sanitizeError } from '../ui/sanitizedError';

export type PaymentReviewRequest = {
  kind: 'request' | 'tip';
  record: PaymentRequestRecord | null;
  peerPubky: string;
  amountBtc: string;
  amountAsset: string;
  reference: string | null;
  destinations: TipEndpointRecord[];
  selected: TipEndpointRecord | null;
};

export function PaymentRequestBubble({
  record,
  localPubky: _localPubky,
  onChanged,
  onReview,
}: {
  record: PaymentRequestRecord;
  localPubky: string;
  onChanged: () => void;
  onReview: (request: PaymentReviewRequest) => void;
}) {
  const nowMs = useTickingNow();
  const [busy, setBusy] = useState(false);
  const [proofDraft, setProofDraft] = useState('');
  const isPayee = record.direction === 'sent';

  const run = useCallback(
    async (body: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await body();
        onChanged();
      } catch (err) {
        const sanitized = sanitizeError(err, COPY.couldNotCompletePaymentAction);
        Alert.alert('Payment', sanitized.message);
      } finally {
        setBusy(false);
      }
    },
    [busy, onChanged],
  );

  return (
    <View testID="paymentRequestBubble">
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
            onReview({
              kind: 'request',
              record,
              peerPubky: record.peerPubky,
              amountBtc: record.amountValue,
              amountAsset: record.amountAsset,
              reference: record.paymentReference,
              destinations: matches,
              selected: matches.length === 1 ? (matches[0] ?? null) : null,
            });
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
    </View>
  );
}
