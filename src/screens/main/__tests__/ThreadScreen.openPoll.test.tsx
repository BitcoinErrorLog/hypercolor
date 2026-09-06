import React from 'react';
import { act, create } from 'react-test-renderer';
import { AppState } from 'react-native';
import { LinkService, THREAD_INBOX_POLL_MS } from '../../../services/link/LinkService';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => {
  // Jest mock factory cannot import ESM; this is the RN effect seam.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(effect, [effect]);
    },
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  };
});

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: {
    hasSession: () => true,
    sendDm: jest.fn(),
    syncInbox: jest.fn().mockResolvedValue([]),
    markRead: jest.fn().mockResolvedValue(undefined),
    getLinkStatus: jest.fn().mockResolvedValue('ready'),
    subscribeInboxSynced: jest.fn().mockReturnValue(() => undefined),
    releaseDeclinedRequest: jest.fn(),
    takeoverReceiver: jest.fn(),
    recoverPendingSends: jest.fn(),
    drainRetries: jest.fn(),
    retryPeerSends: jest.fn(),
  },
  THREAD_INBOX_POLL_MS: 5_000,
}));

const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    getLinkMessagesForConversation: jest.fn().mockResolvedValue([
      {
        ownerPubky: 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo',
        eventId: 'evt-1',
        conversationId: 'dm:pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy',
        peerPubky: 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy',
        senderPubky: 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy',
        direction: 'received',
        kind: 'chat.message.v0',
        rawJson: '{}',
        body: 'hi',
        sentAt: 1,
        receivedAt: 1,
        deliveryState: 'sent',
      },
    ]),
    listAttachmentsForConversation: jest.fn().mockResolvedValue([]),
    listPaymentRequestsForPeer: jest.fn().mockResolvedValue([]),
    listTipEndpoints: jest.fn().mockResolvedValue([]),
    getContact: jest.fn().mockResolvedValue(null),
    getContactNickname: jest.fn().mockResolvedValue(null),
    getThreadLocalPrefs: jest.fn().mockResolvedValue({ muted: false, archived: false }),
    getMessageRequest: jest.fn().mockResolvedValue({ status: 'accepted' }),
  },
}));

jest.mock('../../../services/KeyStore', () => ({
  KeyStore: { getLinkSession: () => ({ alias: 's' }) },
}));

jest.mock('../../../services/payments/PaymentService', () => ({
  PaymentService: { requestPayment: jest.fn() },
}));

jest.mock('../../../components/ComposerAttachButton', () => ({
  pickAndSendFile: jest.fn(),
  pickAndSendPhoto: jest.fn(),
}));

jest.mock('../../../components/ThreadTipBar', () => ({
  ThreadTipBarContent: () => null,
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

jest.mock('../contacts/useThreadPeerGate', () => ({
  useThreadPeerGate: () => ({ peerBlocked: false, runUnblock: jest.fn() }),
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (s: { pubky: string }) => unknown) =>
    select({ pubky: 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo' }),
}));

jest.mock('../../../stores/sessionStatusStore', () => ({
  useSessionStatusStore: (select: (s: { kind: string }) => unknown) => select({ kind: 'enabled' }),
}));

import ThreadScreen from '../ThreadScreen';

describe('open thread inbox poll', () => {
  let appState: string = 'active';
  let onAppState: ((state: string) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    appState = 'active';
    onAppState = undefined;
    (LinkService.syncInbox as jest.Mock).mockClear();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      get: () => appState,
    });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      onAppState = handler as (state: string) => void;
      return { remove: jest.fn() };
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('polls the focused peer at THREAD_INBOX_POLL_MS and pull-to-refresh syncs', async () => {
    expect(THREAD_INBOX_POLL_MS).toBe(5_000);
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <ThreadScreen
          navigation={{} as never}
          route={{ key: 't', name: 'Thread', params: { participantPubky: PEER } } as never}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(LinkService.syncInbox).toHaveBeenCalledWith([PEER]);
    const afterMount = (LinkService.syncInbox as jest.Mock).mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(THREAD_INBOX_POLL_MS);
      await Promise.resolve();
    });
    expect((LinkService.syncInbox as jest.Mock).mock.calls.length).toBeGreaterThan(afterMount);

    const refresh = tree!.root.findByProps({ testID: 'threadRefresh' });
    await act(async () => {
      refresh.props.onRefresh();
      await Promise.resolve();
    });
    expect(LinkService.syncInbox).toHaveBeenCalledWith([PEER]);
    await act(async () => {
      tree!.unmount();
    });
  });

  it('does not poll while backgrounded and resumes on active', async () => {
    await act(async () => {
      create(
        <ThreadScreen
          navigation={{} as never}
          route={{ key: 't', name: 'Thread', params: { participantPubky: PEER } } as never}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const afterMount = (LinkService.syncInbox as jest.Mock).mock.calls.length;
    appState = 'background';
    await act(async () => {
      onAppState?.('background');
    });
    await act(async () => {
      jest.advanceTimersByTime(THREAD_INBOX_POLL_MS * 3);
      await Promise.resolve();
    });
    expect((LinkService.syncInbox as jest.Mock).mock.calls.length).toBe(afterMount);
    appState = 'active';
    await act(async () => {
      onAppState?.('active');
      await Promise.resolve();
    });
    expect((LinkService.syncInbox as jest.Mock).mock.calls.length).toBeGreaterThan(afterMount);
  });
});
