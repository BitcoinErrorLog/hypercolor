import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { color, radius, space, measure } from '../../../theme';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { ThreadScreenContent } from '../ThreadScreen';
import type { Contact } from '../../../types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: {
    hasSession: () => false,
    sendDm: jest.fn(),
    syncInbox: jest.fn(),
    markRead: jest.fn(),
    subscribeInboxSynced: () => () => undefined,
    releaseDeclinedRequest: jest.fn(),
    takeoverReceiver: jest.fn(),
  },
  THREAD_INBOX_POLL_MS: 10_000,
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    getMessageRequest: jest.fn(),
  },
}));

jest.mock('../../../services/KeyStore', () => ({
  KeyStore: { getLinkSession: () => null },
}));

jest.mock('../../../services/payments/PaymentService', () => ({
  PaymentService: { requestPayment: jest.fn() },
}));

jest.mock('../../../components/ComposerAttachButton', () => ({
  ComposerAttachButton: () => null,
}));

jest.mock('../../../components/ThreadTipBar', () => ({
  ThreadTipBar: () => null,
}));

jest.mock('../../../components/AttachmentBubble', () => ({
  AttachmentBubble: () => null,
}));

jest.mock('../../../components/PaymentRequestBubble', () => ({
  PaymentRequestBubble: () => null,
}));

jest.mock('../../../components/PaymentComposeSheet', () => ({
  PaymentComposeSheet: () => null,
}));

jest.mock('../../../components/EnableMessagingCta', () => ({
  EnableMessagingCta: () => null,
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (state: { pubky: null }) => unknown) => select({ pubky: null }),
}));

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const noop = () => undefined;

function contentProps(
  overrides: Partial<React.ComponentProps<typeof ThreadScreenContent>> = {},
): React.ComponentProps<typeof ThreadScreenContent> {
  return {
    participantPubky: PEER,
    localPubky: OWNER,
    draft: 'hello',
    sending: false,
    loading: false,
    linkMessages: [
      {
        ownerPubky: OWNER,
        eventId: 'evt-1',
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: 'sent',
        kind: 'chat.message.v0',
        rawJson: '{}',
        body: 'queued while blocked',
        sentAt: 1,
        receivedAt: null,
        deliveryState: 'failed',
      },
    ],
    attachments: [],
    payments: [],
    tipEndpoints: [],
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
    peerBlocked: false,
    peerDeclined: false,
    onUnblock: noop,
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

describe('ThreadScreenContent blocked send', () => {
  it('shows the blocked copy, Unblock, and a terminal Failed bubble', async () => {
    const onUnblock = jest.fn();
    const tree = await render(
      <ThreadScreenContent {...contentProps({ peerBlocked: true, onUnblock })} />,
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(CONTACTS_COPY.deniedSendMessage);
    expect(json).not.toContain('LinkService.sendDm');
    expect(tree.root.findByProps({ testID: 'threadSend' }).props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: 'threadBubbleMine' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'threadByteCap' })).toHaveLength(0);
    expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Failed')).toBe(true);
    await act(async () => {
      tree.root.findByProps({ testID: 'threadUnblock' }).props.onPress();
    });
    expect(JSON.stringify(tree.toJSON())).toContain(CONTACTS_COPY.unblockTitle);
    await act(async () => {
      tree.root.findByProps({ testID: 'confirmSheetConfirm' }).props.onPress();
    });
    expect(onUnblock).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows the declined-send notice without disabling the composer', async () => {
    const tree = await render(<ThreadScreenContent {...contentProps({ peerDeclined: true })} />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(CONTACTS_COPY.declinedSendNotice);
    expect(tree.root.findByProps({ testID: 'threadSend' }).props.disabled).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'threadBlockedBanner' })).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('uses MessageBubble alignment for mine and theirs messages', async () => {
    const incoming = {
      ...contentProps().linkMessages[0]!,
      eventId: 'evt-2',
      senderPubky: PEER,
      direction: 'received' as const,
      body: 'incoming',
      sentAt: 2,
      deliveryState: 'sent' as const,
    };
    const incoming2 = {
      ...incoming,
      eventId: 'evt-3',
      sentAt: 3,
      body: 'incoming again',
    };
    const tree = await render(
      <ThreadScreenContent
        {...contentProps({ linkMessages: [...contentProps().linkMessages, incoming, incoming2] })}
      />,
    );
    const mineBubble = tree.root
      .findAllByProps({ testID: 'threadBubbleMine' })
      .find(node => node.props.style);
    const theirsBubble = tree.root
      .findAllByProps({ testID: 'threadBubbleTheirs' })
      .find(node => node.props.style);
    expect(StyleSheet.flatten(mineBubble?.props.style)).toMatchObject({
      backgroundColor: color.brand,
    });
    expect(StyleSheet.flatten(theirsBubble?.props.style)).toMatchObject({
      backgroundColor: color.bubbleIncoming,
    });
    expect(
      tree.root
        .findAllByProps({ testID: 'threadBubbleTheirsAvatar' })
        .filter(
          node =>
            (node as unknown as { type: unknown }).type === 'View' &&
            node.props.accessibilityRole === 'image',
        ),
    ).toHaveLength(1);
    const theirsStyles = tree.root
      .findAllByProps({ testID: 'threadBubbleTheirs' })
      .filter(node => node.props.style)
      .map(node => StyleSheet.flatten(node.props.style));
    expect(theirsStyles.some(style => style.borderBottomLeftRadius !== radius.bubbleTail)).toBe(
      true,
    );
    expect(theirsStyles.some(style => style.borderBottomLeftRadius === radius.bubbleTail)).toBe(
      true,
    );
    await act(async () => {
      tree.unmount();
    });
  });

  it('exposes a 44pt named copy target for the peer title', async () => {
    const peerContact: Contact = {
      pubky: PEER,
      ownerPubky: OWNER,
      displayName: 'Aster Example',
      trustScore: 50,
      isFollowing: true,
      isFollower: true,
      isMutual: true,
      addedManually: true,
      firstSeenAt: 1,
    };
    const tree = await render(<ThreadScreenContent {...contentProps({ peerContact })} />);
    const copyTitle = tree.root.findByProps({ accessibilityLabel: 'Copy Aster Example' });
    expect(copyTitle).toBeDefined();
    expect(copyTitle.props.accessibilityRole).toBe('button');
    expect(copyTitle.props.hitSlop).toEqual({
      top: space.md,
      bottom: space.md,
      left: space.md,
      right: space.md,
    });
    expect(copyTitle.props.style.minHeight).toBe(measure.hitTarget);
    await act(async () => {
      tree.unmount();
    });
  });
});
