import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import WelcomeScreen from '../WelcomeScreen';
import { PubkyRingAuthService } from '../../../services/PubkyRingAuthService';
import { PubkyService } from '../../../services/PubkyService';
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

jest.mock('@synonymdev/react-native-pubky', () => ({
  signOut: jest.fn(),
  put: jest.fn(),
  get: jest.fn(),
  deleteFile: jest.fn(),
  list: jest.fn(),
  getHomeserver: jest.fn(),
}));

jest.mock('../../../services/KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(() => null),
    getSessionSecret: jest.fn(),
    isSignOutIncomplete: jest.fn(() => false),
    getSignOutIncompleteOwner: jest.fn(() => null),
    markSignOutIncomplete: jest.fn(),
    clearSignOutIncomplete: jest.fn(),
    clearIfPubky: jest.fn(),
  },
}));

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: { clearSession: jest.fn() },
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    hasSignOutIncompleteJournal: jest.fn().mockResolvedValue(false),
    persistSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    getSignOutIncompleteJournalOwner: jest.fn().mockResolvedValue(null),
    clearSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../services/resetAfterFailedWipe', () => ({
  shouldOfferResetAfterFailedWipe: jest.fn(),
  resetAppDataAfterFailedWipe: jest.fn(),
  recordBootWipeFailure: jest.fn(),
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ clearSession: jest.fn() }),
  },
}));

jest.mock('../../../services/PubkyRingAuthService', () => ({
  PubkyRingAuthService: {
    requestDelegation: jest.fn(),
    isStaleDelegationRequestError: jest.fn().mockReturnValue(false),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

jest.mock('../../../services/PubkyService', () => ({
  PubkyService: {
    awaitSignOutWipe: jest.fn().mockResolvedValue(undefined),
    shouldOfferResetAfterFailedWipe: jest.fn().mockResolvedValue(false),
    resetAppDataAfterFailedWipe: jest.fn().mockResolvedValue(undefined),
    isTypedSignInRestoreError: jest.requireActual('../../../services/PubkyService')
      .isTypedSignInRestoreError,
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
    jest.mocked(PubkyService.awaitSignOutWipe).mockResolvedValue(undefined);
    jest.mocked(PubkyService.shouldOfferResetAfterFailedWipe).mockResolvedValue(false);
    jest.mocked(PubkyService.resetAppDataAfterFailedWipe).mockResolvedValue(undefined);
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

    expect(PubkyService.awaitSignOutWipe).toHaveBeenCalled();
    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledWith(
      expect.stringMatching(/^hypercolor-[0-9a-f]+$/),
    );
    const wipeOrder = jest.mocked(PubkyService.awaitSignOutWipe).mock.invocationCallOrder[0]!;
    const requestOrder = jest.mocked(PubkyRingAuthService.requestDelegation).mock
      .invocationCallOrder[0]!;
    expect(wipeOrder).toBeLessThan(requestOrder);
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

  it('hides Reset app data until two boot wipe failures have been recorded', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    expect(() => tree.root.findByProps({ testID: 'welcomeResetAppData' })).toThrow();
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows Reset app data after two failed boot wipes and confirms through the dialog', async () => {
    jest.mocked(PubkyService.shouldOfferResetAfterFailedWipe).mockResolvedValue(true);
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeResetAppData' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'confirmSheet' })).toBeTruthy();
    const serialized = JSON.stringify(tree.toJSON());
    expect(serialized).toContain(COPY.resetAppDataTitle);
    expect(serialized).toContain(COPY.resetAppDataBody);
    await act(async () => {
      tree.root.findByProps({ testID: 'confirmSheetConfirm' }).props.onPress();
    });
    expect(PubkyService.resetAppDataAfterFailedWipe).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps Reset app data retryable when the confirm step fails', async () => {
    jest.mocked(PubkyService.shouldOfferResetAfterFailedWipe).mockResolvedValue(true);
    jest
      .mocked(PubkyService.resetAppDataAfterFailedWipe)
      .mockRejectedValueOnce(new Error('disk full'));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeResetAppData' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'confirmSheetConfirm' }).props.onPress();
    });
    const serialized = JSON.stringify(tree.toJSON());
    expect(serialized).toContain(COPY.resetAppDataFailed);
    expect(serialized).not.toContain('disk full');
    expect(() => tree.root.findByProps({ testID: 'welcomeResetAppData' })).not.toThrow();
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a generic error and the reset hatch when identity restore fails untyped', async () => {
    jest.mocked(PubkyService.shouldOfferResetAfterFailedWipe).mockResolvedValue(true);
    jest
      .mocked(PubkyService.awaitSignOutWipe)
      .mockRejectedValueOnce(new Error('sqlite disk I/O error'));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });
    const serialized = JSON.stringify(tree.toJSON());
    expect(serialized).toContain(COPY.couldNotStartAuthorization);
    expect(serialized).not.toContain('sqlite disk I/O');
    expect(() => tree.root.findByProps({ testID: 'welcomeResetAppData' })).not.toThrow();
    expect(PubkyService.resetAppDataAfterFailedWipe).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not show the reset hatch when the boot-failure gate is not met', async () => {
    jest.mocked(PubkyService.shouldOfferResetAfterFailedWipe).mockResolvedValue(false);
    jest
      .mocked(PubkyService.awaitSignOutWipe)
      .mockRejectedValueOnce(new Error('sqlite disk I/O error'));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });
    const serialized = JSON.stringify(tree.toJSON());
    expect(serialized).toContain(COPY.couldNotStartAuthorization);
    expect(() => tree.root.findByProps({ testID: 'welcomeResetAppData' })).toThrow();
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not open the reset hatch for a typed wipe-wait timeout', async () => {
    jest
      .mocked(PubkyService.awaitSignOutWipe)
      .mockRejectedValueOnce({ code: 'wipe-wait-timeout', message: 'wipe-wait-timeout' });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });
    const serialized = JSON.stringify(tree.toJSON());
    expect(serialized).toContain(COPY.signOutIncompleteTryAgain);
    expect(serialized).not.toContain('wipe-wait-timeout');
    expect(() => tree.root.findByProps({ testID: 'welcomeResetAppData' })).toThrow();
    await act(async () => {
      tree.unmount();
    });
  });
});
