import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { COPY } from '../../copy/uxCopy';
import { ENDPOINT_BITCOIN_P2TR, ENDPOINT_LIGHTNING_BOLT11 } from '../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
  MAINNET_P2TR,
} from '../../services/payments/__tests__/bolt11Vectors';
import { mapPaymentReview } from '../../ui/paymentReview';
import { PaymentReviewSheet } from '../PaymentReviewSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

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
  it('shows Open wallet with amount and truncated destination', async () => {
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
      destinations: [
        {
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
      ],
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
    ).toBe(COPY.openWallet);
    expect(tree.root.findByProps({ testID: 'paymentReviewAmount' }).props.children).toContain(
      MAINNET_BOLT11_20U_BTC,
    );
    expect(tree.root.findByProps({ testID: 'paymentReviewRecipient' }).props.children).toBe('Ada');
    await unmount(tree);
  });

  it('copies the recipient pubky from the recipient chip', async () => {
    const dest = {
      ownerPubky: 'a'.repeat(52),
      peerPubky: PEER,
      identifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_20U,
      updatedAt: 1,
      validationStatus: 'valid' as const,
      invoiceAmount: MAINNET_BOLT11_20U_BTC,
      invoiceExpiresAt: Date.now() + 60_000,
      paymentHash: MAINNET_BOLT11_20U_HASH,
    };
    const review = mapPaymentReview({
      kind: 'request',
      recipientPubky: PEER,
      recipientContact: null,
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: null,
      endpoint: dest,
      destinations: [dest],
      nowMs: Date.now(),
      destinationsEmpty: false,
      walletUnavailable: false,
    });
    const onCopyRecipientPubky = jest.fn();
    const tree = await render(
      <PaymentReviewSheet
        visible
        review={review}
        busy={false}
        onClose={jest.fn()}
        onContinue={jest.fn()}
        onCopyUri={jest.fn()}
        onCopyRecipientPubky={onCopyRecipientPubky}
      />,
    );
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentReviewShortPubkyCopy' }).props.onPress();
    });
    expect(onCopyRecipientPubky).toHaveBeenCalledTimes(1);
    await unmount(tree);
  });

  it('copies the URI from the primary action when no wallet is available', async () => {
    const dest = {
      ownerPubky: 'a'.repeat(52),
      peerPubky: PEER,
      identifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_20U,
      updatedAt: 1,
      validationStatus: 'valid' as const,
      invoiceAmount: MAINNET_BOLT11_20U_BTC,
      invoiceExpiresAt: Date.now() + 60_000,
      paymentHash: MAINNET_BOLT11_20U_HASH,
    };
    const review = mapPaymentReview({
      kind: 'request',
      recipientPubky: PEER,
      recipientContact: null,
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: null,
      endpoint: dest,
      destinations: [dest],
      nowMs: Date.now(),
      destinationsEmpty: false,
      walletUnavailable: true,
    });
    const onContinue = jest.fn();
    const onCopyUri = jest.fn();
    const tree = await render(
      <PaymentReviewSheet
        visible
        review={review}
        busy={false}
        onClose={jest.fn()}
        onContinue={onContinue}
        onCopyUri={onCopyUri}
      />,
    );
    const primary = tree.root.findByProps({ testID: 'paymentReviewContinue' });
    expect(primary.props.disabled).toBe(false);
    expect(primary.props.accessibilityLabel).toBe(COPY.copyPaymentUri);
    await act(async () => {
      primary.props.onPress();
    });
    expect(onCopyUri).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentReviewCopy' }).props.onPress();
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
    await unmount(tree);
  });

  it('lists matching destinations and waits for a choice when more than one matches', async () => {
    const first = {
      ownerPubky: 'a'.repeat(52),
      peerPubky: PEER,
      identifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_20U,
      updatedAt: 1,
      validationStatus: 'valid' as const,
      invoiceAmount: MAINNET_BOLT11_20U_BTC,
      invoiceExpiresAt: Date.now() + 60_000,
      paymentHash: MAINNET_BOLT11_20U_HASH,
    };
    const second = {
      ...first,
      identifier: 'btc-bitcoin-p2tr',
      payload: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
      invoiceAmount: null,
      paymentHash: null,
    };
    const review = mapPaymentReview({
      kind: 'request',
      recipientPubky: PEER,
      recipientContact: null,
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: null,
      endpoint: null,
      destinations: [first, second],
      nowMs: Date.now(),
      destinationsEmpty: false,
      walletUnavailable: false,
    });
    const onSelect = jest.fn();
    const tree = await render(
      <PaymentReviewSheet
        visible
        review={review}
        busy={false}
        onClose={jest.fn()}
        onContinue={jest.fn()}
        onCopyUri={jest.fn()}
        onSelectDestination={onSelect}
      />,
    );
    expect(tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.disabled).toBe(true);
    await act(async () => {
      tree.root
        .findByProps({ testID: `paymentReviewDestination-${first.identifier}` })
        .props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith(ENDPOINT_LIGHTNING_BOLT11);
    await unmount(tree);
  });

  it('renders the Lightning-only note with a disabled primary for an only-on-chain sub-sat request', async () => {
    const onchain = {
      ownerPubky: 'a'.repeat(52),
      peerPubky: PEER,
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      updatedAt: 1,
      validationStatus: 'valid' as const,
      invoiceAmount: null,
      paymentHash: null,
      invoiceExpiresAt: null,
    };
    const review = mapPaymentReview({
      kind: 'request',
      recipientPubky: PEER,
      recipientContact: null,
      requestAmountBtc: '0.000000001',
      amountAsset: 'btc',
      reference: null,
      endpoint: onchain,
      destinations: [onchain],
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
    expect(tree.root.findByProps({ testID: 'paymentReviewSheet' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: 'paymentReviewWarning' })).toBeTruthy();
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.onlyLightningCanPayAmount);
    expect(tree.root.findAllByProps({ testID: 'paymentReviewCopy' })).toHaveLength(0);
    await unmount(tree);
  });
});
