import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { ThreadScreenContent } from '../ThreadScreen';

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
  },
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

const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const noop = () => undefined;

function contentProps(
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
});
