const mockNavigate = jest.fn();
const mockFocusOnce = { ran: false };
const mockTakePending = jest.fn((_owner?: string): string | null => null);
const mockPeekInvite = jest.fn((): string | null => null);
const mockJoinPublic = jest.fn();
const mockPubkyGet = jest.fn();
const mockPubkyList = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { mode: 'public' } }),
  useFocusEffect: (cb: () => unknown) => {
    if (mockFocusOnce.ran) return;
    mockFocusOnce.ran = true;
    queueMicrotask(() => {
      void cb();
    });
  },
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubky: string }) => unknown) => sel({ pubky: 'a'.repeat(52) }),
}));

jest.mock('../../../services/PubkyService', () => ({
  PubkyService: {
    get: (...args: unknown[]) => mockPubkyGet(...args),
    list: (...args: unknown[]) => mockPubkyList(...args),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    listGroupChannels: jest.fn().mockResolvedValue([]),
    unreadCountsForGroupChannels: jest.fn().mockResolvedValue({}),
    getAllContacts: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../../services/group/GroupService', () => ({
  GroupService: {
    listChannels: jest.fn().mockResolvedValue([]),
    joinPublicChannel: (...args: unknown[]) => mockJoinPublic(...args),
  },
  takePendingPublicJoin: (owner?: string) => mockTakePending(owner),
  peekPendingPublicInvite: () => mockPeekInvite(),
  dismissPendingPublicJoin: jest.fn(),
  subscribeGroupEvents: jest.fn(() => () => undefined),
}));

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChannelsScreen from '../ChannelsScreen';

const HOST = 'h'.repeat(52);
const LOCAL = '11111111-1111-4111-8111-111111111111';
const REF = `hypercolor://join-public?channel=${LOCAL}&host=${HOST}`;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('public graph consent gate', () => {
  beforeEach(() => {
    mockFocusOnce.ran = false;
    mockNavigate.mockReset();
    mockTakePending.mockReset();
    mockTakePending.mockReturnValue(REF);
    mockPeekInvite.mockReset();
    mockPeekInvite.mockReturnValue(REF);
    mockJoinPublic.mockReset();
    mockJoinPublic.mockResolvedValue({ channelId: `${HOST}:${LOCAL}` });
    mockPubkyGet.mockReset();
    mockPubkyList.mockReset();
  });

  it('does not get or list public-channel documents, or join, before Load public topics', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ChannelsScreen />);
    });
    await flush();
    expect(mockPubkyGet).not.toHaveBeenCalled();
    expect(mockPubkyList).not.toHaveBeenCalled();
    expect(mockJoinPublic).not.toHaveBeenCalled();
    expect(mockTakePending).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'channelsLoadPublic' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'channelsPendingInvite' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'channelsPendingJoin' }).props.disabled).toBe(true);
    await act(async () => {
      tree.unmount();
    });
  });

  it('consumes the deferred join only after Load public topics and an explicit Join', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ChannelsScreen />);
    });
    await flush();
    await act(async () => {
      tree.root.findByProps({ testID: 'channelsLoadPublic' }).props.onPress();
    });
    await flush();
    expect(mockJoinPublic).not.toHaveBeenCalled();
    expect(mockTakePending).not.toHaveBeenCalled();
    await act(async () => {
      tree.root.findByProps({ testID: 'channelsPendingJoin' }).props.onPress();
    });
    await flush();
    expect(mockTakePending).toHaveBeenCalled();
    expect(mockJoinPublic).toHaveBeenCalledWith(REF);
    expect(mockPubkyGet).not.toHaveBeenCalled();
    expect(mockPubkyList).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });
});
