import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';

const mockInitKeyStore = jest.fn();
const mockIsInitialized = jest.fn(() => false);
const mockGetPubky = jest.fn();
const mockReadLinkSession = jest.fn();
const mockRecoverPendingSends = jest.fn();
const mockRestorePersistedSession = jest.fn();
const mockReconcileAtBoot = jest.fn();
const mockDrainRetries = jest.fn();
const mockHasSession = jest.fn(() => false);
const mockSyncInbox = jest.fn();
const mockHasInterruptedSignOut = jest.fn();
const mockCompleteInterruptedSignOut = jest.fn();
const mockRecordBootWipeFailure = jest.fn();
const mockMarkKeystoreUnavailable = jest.fn();
const mockRefresh = jest.fn();
const mockStartDrain = jest.fn(() => () => undefined);
const mockShouldHoldPreAuthWork = jest.fn(() => false);
const mockPaintNeedsSignIn = jest.fn();
const mockSweepStaleGifStaging = jest.fn(async () => undefined);
let ownerPaintedListener: (() => void) | null = null;

const appStateListeners: Array<(state: string) => void> = [];

jest.mock('../../src/navigation/RootNavigator', () => ({
  RootNavigator: () => null,
}));

jest.mock('../../src/navigation/e2eClipboardChannel', () => ({
  startE2eClipboardChannel: jest.fn(),
}));

jest.mock('../../src/navigation/e2eDeepLinks', () => ({
  handleE2eDeepLink: jest.fn(),
}));

jest.mock('../../src/navigation/tabBarIcons', () => ({
  loadMainTabIconFont: jest.fn(async () => undefined),
  MainTabBarIcon: () => null,
}));

jest.mock('../../src/services/KeyStore', () => ({
  KeyStore: {
    initKeyStore: (...args: unknown[]) => mockInitKeyStore(...args),
    isInitialized: () => mockIsInitialized(),
    getPubky: (...args: unknown[]) => mockGetPubky(...args),
    getHomeserver: () => null,
    hasPersistedSession: async () => false,
    readLinkSession: (...args: unknown[]) => mockReadLinkSession(...args),
  },
}));

jest.mock('../../src/services/link/LinkService', () => ({
  LinkService: {
    restorePersistedSession: (...args: unknown[]) => mockRestorePersistedSession(...args),
    recoverPendingSends: (...args: unknown[]) => mockRecoverPendingSends(...args),
    reconcileAdoptedSessionsAtBoot: (...args: unknown[]) => mockReconcileAtBoot(...args),
    drainRetries: (...args: unknown[]) => mockDrainRetries(...args),
    hasSession: () => mockHasSession(),
    syncInbox: (...args: unknown[]) => mockSyncInbox(...args),
  },
  startLinkRetryDrain: () => mockStartDrain(),
}));

// Use the real hydrateAuthSession so a double consume would be visible
// as two recordBootWipeFailure calls. Mock only its leaf dependencies.
jest.mock('../../src/services/PubkyService', () => ({
  PubkyService: {
    hasInterruptedSignOut: (...args: unknown[]) => mockHasInterruptedSignOut(...args),
    completeInterruptedSignOut: (...args: unknown[]) => mockCompleteInterruptedSignOut(...args),
  },
}));

jest.mock('../../src/services/resetAfterFailedWipe', () => ({
  recordBootWipeFailure: (...args: unknown[]) => mockRecordBootWipeFailure(...args),
}));

jest.mock('../../src/stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ setAuthenticated: jest.fn() }),
  },
}));

jest.mock('../../src/services/paintedOwner', () => ({
  paintNeedsSignIn: (...args: unknown[]) => mockPaintNeedsSignIn(...args),
  resetPaintOverlayForBoot: jest.fn(),
  registerOnOwnerPainted: (listener: (() => void) | null) => {
    ownerPaintedListener = listener;
  },
  shouldHoldPreAuthWork: () => mockShouldHoldPreAuthWork(),
}));

jest.mock('../../src/stores/sessionStatusStore', () => ({
  useSessionStatusStore: {
    getState: () => ({
      markKeystoreUnavailable: mockMarkKeystoreUnavailable,
      refresh: mockRefresh,
    }),
  },
}));

jest.mock('../../src/ui/reduceMotion', () => ({
  ReduceMotionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../src/services/attachments/fileIo', () => ({
  sweepStaleGifStaging: () => mockSweepStaleGifStaging(),
}));

import App from '../../App';

describe('App keystore boot ordering', () => {
  let addSpy: jest.SpyInstance;
  let tree: { unmount: () => void } | null = null;

  beforeEach(() => {
    appStateListeners.length = 0;
    ownerPaintedListener = null;
    addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
      appStateListeners.push(cb as (state: string) => void);
      return { remove: jest.fn() };
    });
    mockIsInitialized.mockReturnValue(false);
    mockInitKeyStore.mockReset();
    mockGetPubky.mockReset();
    mockReadLinkSession.mockReset();
    mockRecoverPendingSends.mockReset();
    mockRestorePersistedSession.mockReset();
    mockReconcileAtBoot.mockReset();
    mockDrainRetries.mockReset();
    mockHasInterruptedSignOut.mockReset();
    mockCompleteInterruptedSignOut.mockReset();
    mockRecordBootWipeFailure.mockReset();
    mockMarkKeystoreUnavailable.mockReset();
    mockRefresh.mockReset();
    mockStartDrain.mockClear();
    mockSweepStaleGifStaging.mockClear();
    mockShouldHoldPreAuthWork.mockReset();
    mockPaintNeedsSignIn.mockReset();
    mockShouldHoldPreAuthWork.mockReturnValue(false);
    mockInitKeyStore.mockReturnValue(new Promise(() => undefined));
    mockRecoverPendingSends.mockResolvedValue(undefined);
    mockRestorePersistedSession.mockResolvedValue(undefined);
    mockReconcileAtBoot.mockResolvedValue(undefined);
    mockDrainRetries.mockResolvedValue(undefined);
    mockHasInterruptedSignOut.mockResolvedValue(false);
    mockCompleteInterruptedSignOut.mockResolvedValue(undefined);
    mockRecordBootWipeFailure.mockResolvedValue(undefined);
    mockRefresh.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      tree?.unmount();
    });
    tree = null;
    addSpy.mockRestore();
  });

  it('does not register AppState or read KeyStore while init is still pending', async () => {
    await act(async () => {
      tree = create(React.createElement(App));
    });
    expect(addSpy).not.toHaveBeenCalled();
    expect(appStateListeners).toEqual([]);
    expect(mockGetPubky).not.toHaveBeenCalled();
    expect(mockReadLinkSession).not.toHaveBeenCalled();
    expect(mockRecoverPendingSends).not.toHaveBeenCalled();
    expect(mockRestorePersistedSession).not.toHaveBeenCalled();
    expect(mockHasInterruptedSignOut).not.toHaveBeenCalled();
    expect(mockReconcileAtBoot).not.toHaveBeenCalled();
    expect(mockSweepStaleGifStaging).toHaveBeenCalled();
  });

  it('runs init → interrupted wipe → reconcile → hydrate before drain', async () => {
    const callOrder: string[] = [];
    let resolveInit!: () => void;
    mockInitKeyStore.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          callOrder.push('initKeyStore');
          resolveInit = resolve;
        }),
    );
    mockReconcileAtBoot.mockImplementation(async () => {
      callOrder.push('reconcileAdoptedSessionsAtBoot');
    });
    // Real hydrateAuthSession: App calls consume once (hasInterrupted + maybe
    // complete), then hydrate checks hasInterrupted again without completing.
    let interruptedChecks = 0;
    mockHasInterruptedSignOut.mockImplementation(async () => {
      interruptedChecks += 1;
      if (interruptedChecks === 1) {
        callOrder.push('consumeInterruptedSignOutAtBoot');
      } else {
        callOrder.push('hydratePersistedAuth');
      }
      return false;
    });
    mockShouldHoldPreAuthWork.mockReturnValue(true);

    await act(async () => {
      tree = create(React.createElement(App));
    });
    expect(callOrder).toEqual(['initKeyStore']);
    expect(mockHasInterruptedSignOut).not.toHaveBeenCalled();

    mockIsInitialized.mockReturnValue(true);
    await act(async () => {
      resolveInit();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callOrder).toEqual([
      'initKeyStore',
      'consumeInterruptedSignOutAtBoot',
      'reconcileAdoptedSessionsAtBoot',
      'hydratePersistedAuth',
    ]);
    expect(mockStartDrain).not.toHaveBeenCalled();
    expect(ownerPaintedListener).not.toBeNull();

    mockShouldHoldPreAuthWork.mockReturnValue(false);
    await act(async () => {
      ownerPaintedListener?.();
    });
    expect(mockStartDrain).toHaveBeenCalled();
  });

  it('records exactly one boot wipe failure when consume runs once through App boot', async () => {
    let resolveInit!: () => void;
    mockInitKeyStore.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveInit = resolve;
        }),
    );
    mockHasInterruptedSignOut.mockResolvedValue(true);
    mockCompleteInterruptedSignOut.mockRejectedValue(new Error('wipe boom'));
    mockIsInitialized.mockReturnValue(true);

    await act(async () => {
      tree = create(<App />);
    });
    await act(async () => {
      resolveInit();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCompleteInterruptedSignOut).toHaveBeenCalledTimes(1);
    expect(mockRecordBootWipeFailure).toHaveBeenCalledTimes(1);
  });

  it('no-ops AppState active with a fixed log when KeyStore is not ready', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let resolveInit!: () => void;
    mockInitKeyStore.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveInit = resolve;
        }),
    );
    await act(async () => {
      tree = create(React.createElement(App));
    });
    expect(addSpy).not.toHaveBeenCalled();

    mockIsInitialized.mockReturnValue(true);
    await act(async () => {
      resolveInit();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(addSpy).toHaveBeenCalled();

    mockIsInitialized.mockReturnValue(false);
    mockGetPubky.mockClear();
    mockRecoverPendingSends.mockClear();
    mockRestorePersistedSession.mockClear();
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
    });
    expect(warn).toHaveBeenCalledWith('[App] keystore unavailable');
    expect(mockGetPubky).not.toHaveBeenCalled();
    expect(mockRecoverPendingSends).not.toHaveBeenCalled();
    expect(mockRestorePersistedSession).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
