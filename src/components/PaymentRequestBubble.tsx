import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { PaymentRequestCard, useTickingNow } from './PaymentRequestCard';
import { PaymentService } from '../services/payments/PaymentService';
import { openPayUri } from '../services/payments/walletHandoff';
import { PaymentError, type PaymentRequestRecord } from '../types/payment';

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

  return (
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
          const tips = await PaymentService.getPeerTipEndpoints(record.peerPubky);
          const match = tips.find(tip => record.endpointIds.includes(tip.identifier)) ?? tips[0];
          if (!match) {
            throw new PaymentError('not-found', 'No tip destination from this peer yet');
          }
          await openPayUri(match.identifier, match.payload);
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
  );
}
