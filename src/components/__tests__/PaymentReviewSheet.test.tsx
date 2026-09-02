import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { COPY } from '../../copy/uxCopy';
import { ENDPOINT_LIGHTNING_BOLT11 } from '../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
} from '../../services/payments/__tests__/bolt11Vectors';
import { mapPaymentReview } from '../../ui/paymentReview';
import { PaymentReviewSheet } from '../PaymentReviewSheet';

const PEER = 'b'.repeat(52);

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

async function unmount(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    tree.unmount();
  });
}

describe('PaymentReviewSheet', () => {
  it('shows Continue in Bitkit with amount and truncated destination', async () => {
    const review = mapPaymentReview({
      kind: 'request',
      recipientPubky: PEER,
      recipientContact: { displayName: 'Ada', addedManually: true },
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: 'invoice-1',
      endpoint: {
        ownerPubky: 'a'.repeat(52),
        peerPubky: PEER,
        identifier: ENDPOINT_LIGHTNING_BOLT11,
        payload: MAINNET_BOLT11_20U,
        updatedAt: 1,
        validationStatus: 'valid',
        invoiceAmount: MAINNET_BOLT11_20U_BTC,
        invoiceExpiresAt: Date.now() + 60_000,
        paymentHash: MAINNET_BOLT11_20U_HASH,
      },
      nowMs: Date.now(),
      destinationsEmpty: false,
      walletUnavailable: false,
    });
    const tree = await render(
      <PaymentReviewSheet
        visible
        review={review}
        busy={false}
        onClose={jest.fn()}
        onContinue={jest.fn()}
        onCopyUri={jest.fn()}
      />,
    );
    expect(
      tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.accessibilityLabel,
    ).toBe(COPY.continueInBitkit);
    expect(tree.root.findByProps({ testID: 'paymentReviewAmount' }).props.children).toContain(
      MAINNET_BOLT11_20U_BTC,
    );
    expect(tree.root.findByProps({ testID: 'paymentReviewRecipient' }).props.children).toBe('Ada');
    await unmount(tree);
  });
});
