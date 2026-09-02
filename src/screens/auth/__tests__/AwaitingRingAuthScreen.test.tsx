import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AwaitingRingAuthScreen from '../AwaitingRingAuthScreen';
import { COPY, ENABLE_AUTH_TTL_MS } from '../../../copy/uxCopy';
import { PubkyRingAuthService } from '../../../services/PubkyRingAuthService';
import { notifyConnectAuthFeedback } from '../../../ui/connectAuthFeedback';
import { finishConnectDelegation } from '../../../ui/connectDelegationStart';

const PAYKIT_CONNECT_URL =
  'pubkyring://paykit-connect?deviceId=hypercolor-sim&callback=hypercolor%3A%2F%2Fring-callback&ephemeralPk=aabbcc&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw';

const mockGoBack = jest.fn();
const mockSetParams = jest.fn();
const mockUseRoute = jest.fn();
const mockSetString = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, setParams: mockSetParams }),
  useRoute: () => mockUseRoute(),
}));

jest.mock('../../../utils/copyText', () => ({
  copyText: (...args: unknown[]) => mockSetString(...args),
}));

jest.mock('../../../services/PubkyRingAuthService', () => ({
  PubkyRingAuthService: {
    cancelPendingDelegation: jest.fn().mockResolvedValue(undefined),
    getPendingDelegationExpiresAt: jest.fn().mockReturnValue(null),
    getPendingDelegationSnapshot: jest.fn().mockReturnValue(null),
    isStaleDelegationRequestError: jest.fn().mockReturnValue(false),
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
    mockSetParams.mockReset();
    finishConnectDelegation();
    mockUseRoute.mockReturnValue({
      params: {
        ringAuthUrl: PAYKIT_CONNECT_URL,
        expiresAt: Date.now() + ENABLE_AUTH_TTL_MS,
        generation: 1,
      },
    });
    (PubkyRingAuthService.getPendingDelegationExpiresAt as jest.Mock).mockReturnValue(null);
    (PubkyRingAuthService.getPendingDelegationSnapshot as jest.Mock).mockReturnValue(null);
    (PubkyRingAuthService.isStaleDelegationRequestError as jest.Mock).mockReturnValue(false);
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockReset();
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

  it('ignores a second Try again tap while requestDelegation is in flight', async () => {
    let resolveRequest!: (value: { url: string; expiresAt: number; generation: number }) => void;
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRequest = resolve;
        }),
    );
    const tree = await render(<AwaitingRingAuthScreen />);
    await act(async () => {
      notifyConnectAuthFeedback('denied');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'awaitingRingAuthTryAgain' }).props.onPress();
      tree.root.findByProps({ testID: 'awaitingRingAuthTryAgain' }).props.onPress();
    });
    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRequest({
        url: `${PAYKIT_CONNECT_URL}&retry=1`,
        expiresAt: Date.now() + ENABLE_AUTH_TTL_MS,
        generation: 2,
      });
    });
    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledTimes(1);
    await unmount(tree);
  });

  it('writes retried URL and expiry into route params and keeps them across remount', async () => {
    const retryUrl = `${PAYKIT_CONNECT_URL}&ephemeralPk=retry`;
    const retryExpiresAt = Date.now() + ENABLE_AUTH_TTL_MS;
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockResolvedValue({
      url: retryUrl,
      expiresAt: retryExpiresAt,
      generation: 2,
    });
    const tree = await render(<AwaitingRingAuthScreen />);
    await act(async () => {
      notifyConnectAuthFeedback('denied');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'awaitingRingAuthTryAgain' }).props.onPress();
    });
    expect(mockSetParams).toHaveBeenCalledWith({
      ringAuthUrl: retryUrl,
      expiresAt: retryExpiresAt,
      generation: 2,
    });
    await unmount(tree);

    mockUseRoute.mockReturnValue({
      params: { ringAuthUrl: retryUrl, expiresAt: retryExpiresAt, generation: 2 },
    });
    const remounted = await render(<AwaitingRingAuthScreen />);
    expect(remounted.root.findAllByProps({ children: retryUrl }).length).toBeGreaterThan(0);
    expect(remounted.root.findAllByProps({ children: PAYKIT_CONNECT_URL })).toHaveLength(0);
    await unmount(remounted);
  });

  it('shows expired recovery when restored without a coherent pending record', async () => {
    mockUseRoute.mockReturnValue({ params: undefined });
    (PubkyRingAuthService.getPendingDelegationSnapshot as jest.Mock).mockReturnValue(null);
    (PubkyRingAuthService.getPendingDelegationExpiresAt as jest.Mock).mockReturnValue(null);
    const tree = await render(<AwaitingRingAuthScreen />);
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.authorizationExpired);
    expect(tree.root.findAllByProps({ testID: 'authQr' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthGenerateNew' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'awaitingRingAuthOpenRing' })).toHaveLength(0);
    await unmount(tree);
  });
});
