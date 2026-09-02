import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PaymentRequestBubble } from '../PaymentRequestBubble';
import { COPY } from '../../copy/uxCopy';
import { EMPTY_PAYMENT_RECORD_EXTRAS, type PaymentRequestRecord } from '../../types/payment';
import { PaymentService } from '../../services/payments/PaymentService';
import { prepareRequestHandoff } from '../../services/payments/walletHandoff';

jest.mock('../../services/payments/PaymentService', () => ({
  PaymentService: {
    listMatchingTipEndpoints: jest.fn(),
    acceptRequest: jest.fn(),
    rejectRequest: jest.fn(),
    cancelRequest: jest.fn(),
    submitProofManual: jest.fn(),
  },
}));

jest.mock('../../services/payments/walletHandoff', () => {
  const actual = jest.requireActual<typeof import('../../services/payments/walletHandoff')>(
    '../../services/payments/walletHandoff',
  );
  return {
    ...actual,
    prepareRequestHandoff: jest.fn(actual.prepareRequestHandoff),
  };
});

const mockedPayment = jest.mocked(PaymentService);
const mockedHandoff = jest.mocked(prepareRequestHandoff);

function record(partial: Partial<PaymentRequestRecord> = {}): PaymentRequestRecord {
  return {
    ownerPubky: 'a'.repeat(52),
    peerPubky: 'b'.repeat(52),
    direction: 'received',
    paymentRequestId: 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
    eventId: '8a0d8b4c-913f-4e31-9f2c-2a6f5bb4d101',
    amountValue: '1',
    amountAsset: 'usd',
    paymentReference: 'ref',
    endpointIds: ['btc-lightning-bolt11'],
    expiresAt: null,
    status: 'accepted',
    createdAt: 1,
    updatedAt: 1,
    proofJson: null,
    reason: null,
    ...EMPTY_PAYMENT_RECORD_EXTRAS,
    ...partial,
  };
}

describe('PaymentRequestBubble inbound amount gate', () => {
  afterEach(() => {
    mockedPayment.listMatchingTipEndpoints.mockClear();
    mockedHandoff.mockClear();
  });

  it('never opens Review or prepareRequestHandoff for an unsupported asset', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockedPayment.listMatchingTipEndpoints.mockResolvedValue([]);
    const onReview = jest.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <PaymentRequestBubble
          record={record()}
          localPubky={'a'.repeat(52)}
          onChanged={jest.fn()}
          onReview={onReview}
        />,
      );
    });
    await act(async () => {
      const pay = tree.root
        .findAllByProps({ accessibilityRole: 'button' })
        .find(node => node.props.accessibilityLabel === 'Pay in wallet');
      pay?.props.onPress();
    });
    expect(alert).toHaveBeenCalledWith('Payment', COPY.unsupportedPaymentAmount);
    expect(onReview).not.toHaveBeenCalled();
    expect(mockedPayment.listMatchingTipEndpoints).not.toHaveBeenCalled();
    expect(mockedHandoff).not.toHaveBeenCalled();
    alert.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });
});
