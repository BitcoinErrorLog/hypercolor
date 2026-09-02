import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import WelcomeScreen from '../WelcomeScreen';
import { PubkyRingAuthService } from '../../../services/PubkyRingAuthService';
import { COPY } from '../../../copy/uxCopy';
import {
  finishConnectDelegation,
  resetConnectDelegationForTests,
  tryBeginConnectDelegation,
} from '../../../ui/connectDelegationStart';

const PAYKIT_CONNECT_URL =
  'pubkyring://paykit-connect?deviceId=hypercolor-sim&callback=hypercolor%3A%2F%2Fring-callback&ephemeralPk=aabbcc&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw';

const mockNavigate = jest.fn();
let mockFocusCallback: (() => void) | undefined;
let mockLastFocusEffect: (() => void) | undefined;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    mockFocusCallback = cb;
    if (mockLastFocusEffect !== cb) {
      mockLastFocusEffect = cb;
      cb();
    }
  },
}));

jest.mock('../../../services/PubkyRingAuthService', () => ({
  PubkyRingAuthService: {
    requestDelegation: jest.fn(),
    isStaleDelegationRequestError: jest.fn().mockReturnValue(false),
  },
}));

jest.mock('../DebugSignupPanel', () => ({
  DebugSignupPanel: () => null,
}));

describe('WelcomeScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockFocusCallback = undefined;
    mockLastFocusEffect = undefined;
    resetConnectDelegationForTests();
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockReset();
    (PubkyRingAuthService.isStaleDelegationRequestError as jest.Mock).mockReturnValue(false);
  });

  it('shows the custody line and never uses pubky-ring hyphenation', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    expect(tree.root.findByProps({ testID: 'custodyLine' }).props.children).toBe(COPY.custodyLine);
    const serialized = JSON.stringify(tree.toJSON());
    expect(serialized).not.toMatch(/pubky-ring/);
    await act(async () => {
      tree.unmount();
    });
  });

  it('navigates to AwaitingRingAuth with the paykit-connect URL and expiry', async () => {
    const expiresAt = Date.now() + 300_000;
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockResolvedValue({
      url: PAYKIT_CONNECT_URL,
      expiresAt,
      generation: 1,
    });

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });

    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledWith(
      expect.stringMatching(/^hypercolor-[0-9a-f]+$/),
    );
    expect(mockNavigate).toHaveBeenCalledWith('AwaitingRingAuth', {
      ringAuthUrl: PAYKIT_CONNECT_URL,
      expiresAt,
      generation: 1,
    });
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not mint a second authorization while requestDelegation is in flight', async () => {
    let resolveRequest!: (value: { url: string; expiresAt: number }) => void;
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRequest = resolve;
        }),
    );

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });

    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRequest({ url: PAYKIT_CONNECT_URL, expiresAt: Date.now() + 300_000 });
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.unmount();
    });
  });

  it('creates a new request after returning from Awaiting Ring', async () => {
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockResolvedValue({
      url: PAYKIT_CONNECT_URL,
      expiresAt: Date.now() + 300_000,
    });

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });
    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockFocusCallback?.();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });

    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    await act(async () => {
      tree.unmount();
    });
  });

  it('sanitizes connect failures instead of showing Error.message', async () => {
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockRejectedValue(
      new Error('https://evil.example/callback?secret=leak failed'),
    );

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });

    const serialized = JSON.stringify(tree.toJSON());
    expect(serialized).not.toContain('https://evil.example');
    expect(serialized).toContain(COPY.couldNotStartAuthorization);
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not release an Awaiting-owned latch on focus', async () => {
    const awaitingToken = tryBeginConnectDelegation();
    expect(awaitingToken).not.toBeNull();

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      mockFocusCallback?.();
    });
    expect(tryBeginConnectDelegation()).toBeNull();
    finishConnectDelegation(awaitingToken as number);
    expect(tryBeginConnectDelegation()).not.toBeNull();
    resetConnectDelegationForTests();
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a busy Connect state when the delegation latch is already held', async () => {
    const awaitingToken = tryBeginConnectDelegation();
    expect(awaitingToken).not.toBeNull();

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });
    expect(PubkyRingAuthService.requestDelegation).not.toHaveBeenCalled();
    expect(
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ busy: true, disabled: false }));
    expect(
      tree.root.findAllByProps({ children: COPY.connectWithPubkyRing }).length,
    ).toBeGreaterThan(0);
    await act(async () => {
      finishConnectDelegation(awaitingToken as number);
    });
    expect(
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ busy: false, disabled: false }));
    resetConnectDelegationForTests();
    await act(async () => {
      tree.unmount();
    });
  });
});
