import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatsScreen from '../ChatsScreen';
import { StorageService } from '../../../services/StorageService';
import { COPY } from '../../../copy/uxCopy';

const mockOwnerPubky = 'a'.repeat(52);
const mockPeerPubky = 'b'.repeat(52);

const mockNavigate = jest.fn();
const mockFocusOnce = { ran: false };
const mockSessionState = {
  kind: 'enabled' as string,
  pendingRequestCount: 2,
  refresh: jest.fn().mockResolvedValue(undefined),
  setPendingRequestCount: jest.fn((count: number) => {
    mockSessionState.pendingRequestCount = count;
  }),
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => unknown) => {
    if (mockFocusOnce.ran) return;
    mockFocusOnce.ran = true;
    queueMicrotask(() => {
      void cb();
    });
  },
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubky: string }) => unknown) => sel({ pubky: mockOwnerPubky }),
}));

jest.mock('../../../stores/sessionStatusStore', () => ({
  useSessionStatusStore: (sel: (s: typeof mockSessionState) => unknown) => sel(mockSessionState),
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    listLinkConversations: jest.fn(),
    countPendingMessageRequests: jest.fn(),
    getAllContacts: jest.fn(),
  },
}));

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: {
    hasSession: jest.fn(() => true),
    syncInbox: jest.fn().mockResolvedValue(undefined),
    subscribeInboxSynced: jest.fn(() => () => undefined),
    takeoverReceiver: jest.fn(),
  },
}));

jest.mock('../../../utils/copyText', () => ({
  copyText: jest.fn(),
}));

async function renderScreen(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ChatsScreen />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

describe('ChatsScreen', () => {
  beforeEach(() => {
    mockFocusOnce.ran = false;
    mockSessionState.kind = 'enabled';
    mockSessionState.pendingRequestCount = 2;
    (StorageService.listLinkConversations as jest.Mock).mockResolvedValue([
      {
        conversationId: `dm:${mockPeerPubky}`,
        participantPubky: mockPeerPubky,
        lastMessage: 'hi',
        lastMessageAt: 1,
        lastKind: 'chat',
        unreadCount: 0,
      },
      {
        conversationId: `group:${mockPeerPubky}`,
        participantPubky: mockPeerPubky,
        lastMessage: 'room',
        lastMessageAt: 1,
        lastKind: 'group',
        unreadCount: 0,
      },
    ]);
    (StorageService.countPendingMessageRequests as jest.Mock).mockResolvedValue(2);
    (StorageService.getAllContacts as jest.Mock).mockResolvedValue([]);
  });

  it('lists DMs only, pins Message requests, and badges the pending count', async () => {
    const tree = await renderScreen();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('hi');
    expect(json).not.toContain('room');
    expect(json).not.toContain('group:');
    expect(tree.root.findByProps({ testID: 'chatsMessageRequests' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'chatsRequestsBadge' }).props.label).toBe('2');
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.messageRequests);
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps the Message requests row when the list is empty', async () => {
    (StorageService.listLinkConversations as jest.Mock).mockResolvedValue([]);
    mockSessionState.pendingRequestCount = 0;
    (StorageService.countPendingMessageRequests as jest.Mock).mockResolvedValue(0);
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'chatsMessageRequests' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'chatsRequestsBadge' })).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.noChatsYet);
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.chatsEmptyBody);
    await act(async () => {
      tree.unmount();
    });
  });

  it('disables New chat and shows the enable CTA when messaging is not enabled', async () => {
    mockSessionState.kind = 'needs-enable';
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'chatsNew' }).props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(tree.root.findByProps({ testID: 'chatsEnableMessaging' })).toBeTruthy();
    await act(async () => {
      tree.unmount();
    });
  });
});
