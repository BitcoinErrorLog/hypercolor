jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubky: string | null }) => unknown) => sel({ pubky: 'a'.repeat(52) }),
}));

jest.mock('../../../stores/sessionStatusStore', () => ({
  useSessionStatusStore: (sel: (s: { kind: string }) => unknown) => sel({ kind: 'enabled' }),
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    hasQueueItemForMessage: jest.fn().mockResolvedValue(false),
  },
}));

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: {
    sendDm: jest.fn(),
    getLinkStatus: jest.fn(),
    recoverPendingSends: jest.fn(),
    drainRetries: jest.fn(),
    subscribeInboxSynced: jest.fn(() => () => undefined),
    syncInbox: jest.fn(),
  },
}));

jest.mock('../../../services/payments/PaymentService', () => ({
  PaymentService: {
    requestPayment: jest.fn(),
    sendTipList: jest.fn(),
    recordDisplayedInvoice: jest.fn(),
    listMatchingTipEndpoints: jest.fn(),
  },
}));

jest.mock('../../../components/ComposerAttachButton', () => ({
  pickAndSendPhoto: jest.fn(),
  pickAndSendFile: jest.fn(),
}));

jest.mock('../../../components/AttachmentBubble', () => ({
  AttachmentBubble: () => null,
}));

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ENDPOINT_BITCOIN_P2TR,
  ENDPOINT_LIGHTNING_BOLT11,
  type TipEndpointRecord,
} from '../../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
  MAINNET_BOLT11_AMOUNTLESS,
  MAINNET_P2TR,
} from '../../../services/payments/__tests__/bolt11Vectors';
import type { PaymentReviewRequest } from '../../../components/PaymentRequestBubble';
import { COPY } from '../../../copy/uxCopy';
import { ThreadScreenContent } from '../ThreadScreen';
import type { LinkMessage } from '../../../types/link';

const PEER = 'b'.repeat(52);

function endpoint(partial: Partial<TipEndpointRecord> = {}): TipEndpointRecord {
  return {
    ownerPubky: 'a'.repeat(52),
    peerPubky: PEER,
    identifier: ENDPOINT_LIGHTNING_BOLT11,
    payload: MAINNET_BOLT11_20U,
    updatedAt: 1,
    validationStatus: 'valid',
    invoiceAmount: MAINNET_BOLT11_20U_BTC,
    invoiceExpiresAt: Date.now() + 60_000,
    paymentHash: MAINNET_BOLT11_20U_HASH,
    ...partial,
  };
}

const noop = () => undefined;

function props(
  overrides: Partial<React.ComponentProps<typeof ThreadScreenContent>> = {},
): React.ComponentProps<typeof ThreadScreenContent> {
  return {
    participantPubky: PEER,
    localPubky: 'a'.repeat(52),
    draft: '',
    sending: false,
    loading: false,
    linkMessages: [],
    attachments: [],
    payments: [],
    tipEndpoints: [endpoint()],
    composePayment: false,
    composeIntent: 'request',
    paymentBusy: false,
    actionMenuOpen: false,
    tipPickerOpen: false,
    review: null,
    walletUnavailable: false,
    recordFailed: false,
    reviewHandoffError: null,
    retryableEventIds: new Set<string>(),
    composerNotice: null,
    onBack: noop,
    onChangeDraft: noop,
    onSend: noop,
    onOpenActionMenu: noop,
    onCloseActionMenu: noop,
    onComposerAction: noop,
    onClosePaymentCompose: noop,
    onSubmitPayment: noop,
    onPaymentsChanged: noop,
    onReview: noop,
    onCloseReview: noop,
    onCloseTipPicker: noop,
    onNeedTipAmount: noop,
    onContinueReview: noop,
    sessionKind: 'enabled',
    peerContact: null,
    linkStatus: 'ready',
    onEnableMessaging: noop,
    onRetryFailed: noop,
    onCopyPubky: noop,
    ...overrides,
  };
}

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

describe('Thread payment compose → Review → handoff', () => {
  it('cannot open the wallet from the tip amount sheet', async () => {
    const onSubmitPayment = jest.fn();
    const onContinueReview = jest.fn();
    const tree = await render(
      <ThreadScreenContent
        {...props({
          composePayment: true,
          composeIntent: 'tip',
          onSubmitPayment,
          onContinueReview,
        })}
      />,
    );
    expect(tree.root.findAllByProps({ testID: 'paymentReviewSheet' })).toHaveLength(0);
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentComposeAmount' }).props.onChangeText('0.001');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentComposeSubmit' }).props.onPress();
    });
    expect(onSubmitPayment).toHaveBeenCalledWith('0.001', '');
    expect(onContinueReview).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('opens the wallet only from Payment Review', async () => {
    const onContinueReview = jest.fn();
    const dest = endpoint();
    const review: PaymentReviewRequest = {
      kind: 'tip',
      record: null,
      peerPubky: PEER,
      amountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: null,
      destinations: [dest],
      selected: dest,
    };
    const tree = await render(<ThreadScreenContent {...props({ review, onContinueReview })} />);
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.onPress();
    });
    expect(onContinueReview).toHaveBeenCalledTimes(1);
    expect(onContinueReview.mock.calls[0][0]).toMatch(/^lightning:/);
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps Open wallet disabled for a zero-value tip', async () => {
    const dest = endpoint({
      payload: MAINNET_BOLT11_AMOUNTLESS,
      invoiceAmount: null,
      paymentHash: null,
    });
    const review: PaymentReviewRequest = {
      kind: 'tip',
      record: null,
      peerPubky: PEER,
      amountBtc: '0',
      amountAsset: 'btc',
      reference: null,
      destinations: [dest],
      selected: dest,
    };
    const onContinueReview = jest.fn();
    const tree = await render(<ThreadScreenContent {...props({ review, onContinueReview })} />);
    expect(tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.disabled).toBe(true);
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.onPress();
    });
    expect(onContinueReview).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('asks the user to pick when more than one destination matches', async () => {
    const first = endpoint();
    const second = endpoint({
      identifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
      invoiceAmount: null,
      paymentHash: null,
    });
    const onReview = jest.fn();
    const review: PaymentReviewRequest = {
      kind: 'request',
      record: null,
      peerPubky: PEER,
      amountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: 'invoice-1',
      destinations: [first, second],
      selected: null,
    };
    const tree = await render(<ThreadScreenContent {...props({ review, onReview })} />);
    expect(tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.disabled).toBe(true);
    await act(async () => {
      tree.root
        .findByProps({ testID: `paymentReviewDestination-${ENDPOINT_LIGHTNING_BOLT11}` })
        .props.onPress();
    });
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ selected: first }));
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps Copy reachable and shows a sanitized handoff error', async () => {
    const dest = endpoint();
    const review: PaymentReviewRequest = {
      kind: 'request',
      record: null,
      peerPubky: PEER,
      amountBtc: MAINNET_BOLT11_20U_BTC,
      amountAsset: 'btc',
      reference: 'invoice-1',
      destinations: [dest],
      selected: dest,
    };
    const tree = await render(
      <ThreadScreenContent
        {...props({
          review,
          walletUnavailable: true,
          reviewHandoffError: COPY.couldNotOpenWallet,
        })}
      />,
    );
    expect(
      tree.root.findByProps({ testID: 'paymentReviewContinue' }).props.accessibilityLabel,
    ).toBe(COPY.copyPaymentUri);
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.couldNotOpenWallet);
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a terminal no-Retry state for a permanently dropped send', async () => {
    const message: LinkMessage = {
      ownerPubky: 'a'.repeat(52),
      eventId: '33333333-3333-4333-8333-333333333333',
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: 'a'.repeat(52),
      direction: 'sent',
      kind: 'hypercolor.chat.message',
      rawJson: '{}',
      body: 'hello',
      sentAt: 1,
      receivedAt: null,
      deliveryState: 'failed',
    };
    const tree = await render(
      <ThreadScreenContent {...props({ linkMessages: [message], retryableEventIds: new Set() })} />,
    );
    expect(tree.root.findByProps({ testID: 'threadSendTerminal' }).props.children).toBe(
      COPY.couldNotSendStartAgain,
    );
    expect(tree.root.findAllByProps({ accessibilityLabel: COPY.retry })).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('offers Retry when the delivery queue still holds the send', async () => {
    const onRetryFailed = jest.fn();
    const eventId = '33333333-3333-4333-8333-333333333333';
    const message: LinkMessage = {
      ownerPubky: 'a'.repeat(52),
      eventId,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: 'a'.repeat(52),
      direction: 'sent',
      kind: 'hypercolor.chat.message',
      rawJson: '{}',
      body: 'hello',
      sentAt: 1,
      receivedAt: null,
      deliveryState: 'failed',
    };
    const tree = await render(
      <ThreadScreenContent
        {...props({
          linkMessages: [message],
          retryableEventIds: new Set([eventId]),
          onRetryFailed,
        })}
      />,
    );
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: COPY.retry }).props.onPress();
    });
    expect(onRetryFailed).toHaveBeenCalledWith(eventId);
    await act(async () => {
      tree.unmount();
    });
  });
});
