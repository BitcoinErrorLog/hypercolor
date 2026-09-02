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
const mockHydrate = jest.fn();
const mockConsumeInterruptedSignOut = jest.fn();
const mockMarkKeystoreUnavailable = jest.fn();
const mockRefresh = jest.fn();
const mockStartDrain = jest.fn(() => () => undefined);
const mockShouldHoldPreAuthWork = jest.fn(() => false);
const mockPaintNeedsSignIn = jest.fn();
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

jest.mock('../../src/stores/hydrateAuthSession', () => ({
  consumeInterruptedSignOutAtBoot: (...args: unknown[]) => mockConsumeInterruptedSignOut(...args),
  hydratePersistedAuth: (...args: unknown[]) => mockHydrate(...args),
}));

jest.mock('../../src/services/paintedOwner', () => ({
  paintNeedsSignIn: (...args: unknown[]) => mockPaintNeedsSignIn(...args),
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
    mockHydrate.mockReset();
    mockConsumeInterruptedSignOut.mockReset();
    mockMarkKeystoreUnavailable.mockReset();
    mockRefresh.mockReset();
    mockStartDrain.mockClear();
    mockShouldHoldPreAuthWork.mockReset();
    mockPaintNeedsSignIn.mockReset();
    mockShouldHoldPreAuthWork.mockReturnValue(false);
    mockInitKeyStore.mockReturnValue(new Promise(() => undefined));
    mockRecoverPendingSends.mockResolvedValue(undefined);
    mockRestorePersistedSession.mockResolvedValue(undefined);
    mockReconcileAtBoot.mockResolvedValue(undefined);
    mockDrainRetries.mockResolvedValue(undefined);
    mockHydrate.mockResolvedValue(false);
    mockConsumeInterruptedSignOut.mockResolvedValue('none');
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
    expect(mockConsumeInterruptedSignOut).not.toHaveBeenCalled();
    expect(mockReconcileAtBoot).not.toHaveBeenCalled();
    expect(mockHydrate).not.toHaveBeenCalled();
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
    mockConsumeInterruptedSignOut.mockImplementation(async () => {
      callOrder.push('consumeInterruptedSignOutAtBoot');
      return 'none';
    });
    mockReconcileAtBoot.mockImplementation(async () => {
      callOrder.push('reconcileAdoptedSessionsAtBoot');
    });
    mockHydrate.mockImplementation(async () => {
      callOrder.push('hydratePersistedAuth');
      return false;
    });
    mockShouldHoldPreAuthWork.mockReturnValue(true);

    await act(async () => {
      tree = create(React.createElement(App));
    });
    expect(callOrder).toEqual(['initKeyStore']);
    expect(mockConsumeInterruptedSignOut).not.toHaveBeenCalled();

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
