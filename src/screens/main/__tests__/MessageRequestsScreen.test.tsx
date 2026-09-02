import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import MessageRequestsScreen from '../MessageRequestsScreen';
import { StorageService } from '../../../services/StorageService';
import { LinkService } from '../../../services/link/LinkService';
import { useSessionStatusStore } from '../../../stores/sessionStatusStore';

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
  });

  it('sets the pending request count to the remaining list after decline', async () => {
    (StorageService.listMessageRequests as jest.Mock)
      .mockResolvedValueOnce([
        { ownerPubky: mockOwnerPubky, peerPubky: PEER_A, status: 'pending' },
        { ownerPubky: mockOwnerPubky, peerPubky: PEER_B, status: 'pending' },
      ])
      .mockResolvedValueOnce([
        { ownerPubky: mockOwnerPubky, peerPubky: PEER_B, status: 'pending' },
      ]);

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
});
