import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AwaitingRingAuthScreen from '../AwaitingRingAuthScreen';
import { COPY, ENABLE_AUTH_TTL_MS } from '../../../copy/uxCopy';
import { PubkyRingAuthService } from '../../../services/PubkyRingAuthService';
import { notifyConnectAuthFeedback } from '../../../ui/connectAuthFeedback';

const PAYKIT_CONNECT_URL =
  'pubkyring://paykit-connect?deviceId=hypercolor-sim&callback=hypercolor%3A%2F%2Fring-callback&ephemeralPk=aabbcc&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw';

const mockGoBack = jest.fn();
const mockUseRoute = jest.fn();
const mockSetString = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => mockUseRoute(),
}));

jest.mock('../../../utils/copyText', () => ({
  copyText: (...args: unknown[]) => mockSetString(...args),
}));

jest.mock('../../../services/PubkyRingAuthService', () => ({
  PubkyRingAuthService: {
    cancelPendingDelegation: jest.fn().mockResolvedValue(undefined),
    getPendingDelegationExpiresAt: jest.fn().mockReturnValue(null),
    requestDelegation: jest.fn(),
  },
}));

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

describe('AwaitingRingAuthScreen', () => {
  beforeEach(() => {
    mockSetString.mockReset();
    mockGoBack.mockReset();
    mockUseRoute.mockReturnValue({
      params: { ringAuthUrl: PAYKIT_CONNECT_URL, expiresAt: Date.now() + ENABLE_AUTH_TTL_MS },
    });
    (PubkyRingAuthService.getPendingDelegationExpiresAt as jest.Mock).mockReturnValue(null);
  });

  it('shows a QR of the paykit-connect URL and first-class scan copy', async () => {
    const tree = await render(<AwaitingRingAuthScreen />);

    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthScanHint' }).props.children).toBe(
      COPY.waitingForRingBody,
    );
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Bitkit/);
    expect(tree.root.findAllByProps({ children: PAYKIT_CONNECT_URL }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthOpenRing' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthCopy' })).toBeTruthy();
    await unmount(tree);
  });

  it('copies the paykit-connect URL', async () => {
    const tree = await render(<AwaitingRingAuthScreen />);

    act(() => {
      tree.root.findByProps({ testID: 'awaitingRingAuthCopy' }).props.onPress();
    });

    expect(mockSetString).toHaveBeenCalledWith(PAYKIT_CONNECT_URL);
    await unmount(tree);
  });

  it('hides the QR when no URL was passed', async () => {
    mockUseRoute.mockReturnValue({
      params: { ringAuthUrl: '', expiresAt: Date.now() + ENABLE_AUTH_TTL_MS },
    });
    const tree = await render(<AwaitingRingAuthScreen />);
    expect(tree.root.findAllByProps({ testID: 'authQr' })).toHaveLength(0);
    await unmount(tree);
  });

  it('cancels the pending authorization from Back', async () => {
    const tree = await render(<AwaitingRingAuthScreen />);
    await act(async () => {
      tree.root.findByProps({ testID: 'awaitingRingAuthCancel' }).props.onPress();
    });
    expect(PubkyRingAuthService.cancelPendingDelegation).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
    await unmount(tree);
  });

  it('hides the QR when the remaining TTL is already zero', async () => {
    mockUseRoute.mockReturnValue({
      params: { ringAuthUrl: PAYKIT_CONNECT_URL, expiresAt: Date.now() - 1 },
    });
    const tree = await render(<AwaitingRingAuthScreen />);
    expect(tree.root.findAllByProps({ testID: 'authQr' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthGenerateNew' })).toBeTruthy();
    await unmount(tree);
  });

  it('surfaces denied and offline from Connect callback feedback', async () => {
    const tree = await render(<AwaitingRingAuthScreen />);
    await act(async () => {
      notifyConnectAuthFeedback('denied');
    });
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.authorizationDeclined);
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthTryAgain' })).toBeTruthy();

    await act(async () => {
      notifyConnectAuthFeedback('offline');
    });
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.sessionOffline);
    await unmount(tree);
  });
});
