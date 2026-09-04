import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import MessageRequestsScreen from '../MessageRequestsScreen';
import { StorageService } from '../../../services/StorageService';
import { LinkService } from '../../../services/link/LinkService';
import { useSessionStatusStore } from '../../../stores/sessionStatusStore';
import { copyText } from '../../../utils/copyText';

const mockOwnerPubky = 'a'.repeat(52);
const PEER_A = 'b'.repeat(52);
const PEER_B = 'c'.repeat(52);

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockSetPendingRequestCount = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubky: string }) => unknown) => sel({ pubky: mockOwnerPubky }),
}));

jest.mock('../../../stores/sessionStatusStore', () => ({
  useSessionStatusStore: {
    getState: () => ({ setPendingRequestCount: mockSetPendingRequestCount }),
  },
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    listMessageRequests: jest.fn(),
    getContact: jest.fn(),
  },
}));

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: {
    acceptMessageRequest: jest.fn(),
    acceptDeclinedRequest: jest.fn(),
    declineMessageRequest: jest.fn(),
  },
}));

jest.mock('../../../utils/copyText', () => ({
  copyText: jest.fn(),
}));

describe('MessageRequestsScreen', () => {
  beforeEach(() => {
    mockSetPendingRequestCount.mockReset();
    mockNavigate.mockReset();
    (StorageService.getContact as jest.Mock).mockResolvedValue(null);
    (LinkService.declineMessageRequest as jest.Mock).mockResolvedValue(undefined);
    (LinkService.acceptMessageRequest as jest.Mock).mockResolvedValue(undefined);
    (LinkService.acceptDeclinedRequest as jest.Mock).mockResolvedValue(undefined);
    (copyText as jest.Mock).mockReset();
  });

  it('sets the pending request count to the remaining list after decline', async () => {
    let pending = [
      { ownerPubky: mockOwnerPubky, peerPubky: PEER_A, status: 'pending' },
      { ownerPubky: mockOwnerPubky, peerPubky: PEER_B, status: 'pending' },
    ];
    (StorageService.listMessageRequests as jest.Mock).mockImplementation(
      async (_owner: string, status?: string) => {
        if (status === 'declined') return [];
        return pending;
      },
    );
    (LinkService.declineMessageRequest as jest.Mock).mockImplementation(async (peer: string) => {
      pending = pending.filter(row => row.peerPubky !== peer);
    });

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<MessageRequestsScreen />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSetPendingRequestCount).toHaveBeenLastCalledWith(2);

    const declineButtons = tree.root.findAllByProps({ testID: 'messageRequestDecline' });
    expect(declineButtons.length).toBeGreaterThan(0);
    const acceptButton = tree.root.findAllByProps({ testID: 'messageRequestAccept' })[0]!;
    expect(acceptButton.props.accessibilityLabel).toBe('Accept message request from bbbbbb…bbbb');
    expect(declineButtons[0]!.props.accessibilityLabel).toBe(
      'Decline message request from bbbbbb…bbbb',
    );
    const chip = tree.root
      .findAllByProps({ testID: 'messageRequestPubkyChip' })
      .find(node => node.props.accessibilityRole === 'text')!;
    expect(chip.props.accessibilityLabel).toBe(PEER_A);
    await act(async () => {
      chip.props.onLongPress();
    });
    expect(copyText).toHaveBeenCalledWith(PEER_A);
    await act(async () => {
      declineButtons[0]!.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(LinkService.declineMessageRequest).toHaveBeenCalledWith(PEER_A);
    expect(mockSetPendingRequestCount).toHaveBeenLastCalledWith(1);
    expect(useSessionStatusStore.getState().setPendingRequestCount).toHaveBeenCalledWith(1);
    await act(async () => {
      tree.unmount();
    });
  });

  it('lists declined rows with Accept that calls acceptDeclinedRequest', async () => {
    (StorageService.listMessageRequests as jest.Mock).mockImplementation(
      async (_owner: string, status?: string) => {
        if (status === 'declined') {
          return [{ ownerPubky: mockOwnerPubky, peerPubky: PEER_A, status: 'declined' }];
        }
        return [];
      },
    );

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<MessageRequestsScreen />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'messageRequestsDeclinedSection' }).props.children).toBe(
      'Declined',
    );
    const accept = tree.root.findByProps({ testID: 'messageRequestAcceptDeclined' });
    expect(accept.props.accessibilityLabel).toBe('Accept declined request from bbbbbb…bbbb');
    await act(async () => {
      accept.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(LinkService.acceptDeclinedRequest).toHaveBeenCalledWith(PEER_A);
    expect(LinkService.acceptMessageRequest).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Thread', expect.anything());
    await act(async () => {
      tree.unmount();
    });
  });
});
