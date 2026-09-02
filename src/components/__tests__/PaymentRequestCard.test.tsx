import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EMPTY_PAYMENT_RECORD_EXTRAS, type PaymentRequestRecord } from '../../types/payment';
import { COPY } from '../../copy/uxCopy';
import { PaymentRequestCard } from '../PaymentRequestCard';

function record(partial: Partial<PaymentRequestRecord> = {}): PaymentRequestRecord {
  return {
    ownerPubky: 'a'.repeat(52),
    peerPubky: 'b'.repeat(52),
    direction: 'received',
    paymentRequestId: 'req-1',
    eventId: 'evt-1',
    amountValue: '0.001',
    amountAsset: 'btc',
    paymentReference: 'ref',
    endpointIds: [],
    expiresAt: null,
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    proofJson: null,
    reason: null,
    ...EMPTY_PAYMENT_RECORD_EXTRAS,
    ...partial,
  };
}

const noop = () => undefined;

describe('PaymentRequestCard', () => {
  it('hides Accept and Reject while a payment event is in flight', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <PaymentRequestCard
          record={record({ pendingEventId: 'queued-event' })}
          isPayee={false}
          nowMs={1_000}
          busy={false}
          proofDraft=""
          onChangeProofDraft={noop}
          onAccept={noop}
          onReject={noop}
          onCancel={noop}
          onPayInWallet={noop}
          onSubmitProof={noop}
        />,
      );
    });
    const labels = tree.root
      .findAllByProps({ accessibilityRole: 'button' })
      .map(node => node.props.accessibilityLabel);
    expect(labels).not.toContain('Accept');
    expect(labels).not.toContain('Reject');
    expect(tree.root.findByProps({ testID: 'paymentRequestSending' })).toBeTruthy();
    expect(
      tree.root.findByProps({ testID: 'paymentRequestSending' }).props.accessibilityLabel,
    ).toBe(COPY.paymentSending);
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows Accept and Reject on a pending request with no in-flight event', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <PaymentRequestCard
          record={record({ pendingEventId: null })}
          isPayee={false}
          nowMs={1_000}
          busy={false}
          proofDraft=""
          onChangeProofDraft={noop}
          onAccept={noop}
          onReject={noop}
          onCancel={noop}
          onPayInWallet={noop}
          onSubmitProof={noop}
        />,
      );
    });
    const labels = tree.root
      .findAllByProps({ accessibilityRole: 'button' })
      .map(node => node.props.accessibilityLabel);
    expect(labels).toContain('Accept');
    expect(labels).toContain('Reject');
    expect(tree.root.findAllByProps({ testID: 'paymentRequestSending' })).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });
});
