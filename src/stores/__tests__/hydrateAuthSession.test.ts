const mockHasPersistedSession = jest.fn();
const mockGetPubky = jest.fn();
const mockGetHomeserver = jest.fn();
const mockIsInitialized = jest.fn();
const mockSetAuthenticated = jest.fn();
const mockHasInterrupted = jest.fn();
const mockCompleteInterrupted = jest.fn();
const mockRecordBootWipeFailure = jest.fn();
const mockPaintNeedsSignIn = jest.fn();
const mockResetPaintOverlayForBoot = jest.fn();

jest.mock('../../services/KeyStore', () => ({
  KeyStore: {
    hasPersistedSession: (...args: unknown[]) => mockHasPersistedSession(...args),
    getPubky: (...args: unknown[]) => mockGetPubky(...args),
    getHomeserver: (...args: unknown[]) => mockGetHomeserver(...args),
    isInitialized: (...args: unknown[]) => mockIsInitialized(...args),
  },
}));

jest.mock('../../services/PubkyService', () => ({
  PubkyService: {
    hasInterruptedSignOut: (...args: unknown[]) => mockHasInterrupted(...args),
    completeInterruptedSignOut: (...args: unknown[]) => mockCompleteInterrupted(...args),
  },
}));

jest.mock('../../services/resetAfterFailedWipe', () => ({
  recordBootWipeFailure: (...args: unknown[]) => mockRecordBootWipeFailure(...args),
}));

jest.mock('../../services/paintedOwner', () => ({
  paintNeedsSignIn: (...args: unknown[]) => mockPaintNeedsSignIn(...args),
  resetPaintOverlayForBoot: (...args: unknown[]) => mockResetPaintOverlayForBoot(...args),
}));

jest.mock('../authStore', () => ({
  useAuthStore: {
    getState: () => ({ setAuthenticated: mockSetAuthenticated }),
  },
}));

import { consumeInterruptedSignOutAtBoot, hydratePersistedAuth } from '../hydrateAuthSession';

describe('consumeInterruptedSignOutAtBoot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasInterrupted.mockResolvedValue(false);
    mockCompleteInterrupted.mockResolvedValue(undefined);
    mockRecordBootWipeFailure.mockResolvedValue(undefined);
  });

  it('returns none when no interrupted sign-out marker is present', async () => {
    await expect(consumeInterruptedSignOutAtBoot()).resolves.toBe('none');
    expect(mockCompleteInterrupted).not.toHaveBeenCalled();
  });

  it('completes an interrupted sign-out before painting any owner', async () => {
    mockHasInterrupted.mockResolvedValue(true);
    await expect(consumeInterruptedSignOutAtBoot()).resolves.toBe('wiped');
    expect(mockCompleteInterrupted).toHaveBeenCalled();
    expect(mockPaintNeedsSignIn).not.toHaveBeenCalled();
  });

  it('paints needs-sign-in when the marker cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockHasInterrupted.mockRejectedValue(new Error('mmkv sealed'));
    await expect(consumeInterruptedSignOutAtBoot()).resolves.toBe('unreadable');
    expect(mockCompleteInterrupted).not.toHaveBeenCalled();
    expect(mockPaintNeedsSignIn).toHaveBeenCalled();
    expect(mockRecordBootWipeFailure).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('interrupted sign-out marker unreadable');
    warn.mockRestore();
  });

  it('records a boot wipe failure when the wipe throws', async () => {
    mockHasInterrupted.mockResolvedValue(true);
    mockCompleteInterrupted.mockRejectedValue(new Error('sql locked'));
    await expect(consumeInterruptedSignOutAtBoot()).resolves.toBe('wipe-failed');
    expect(mockRecordBootWipeFailure).toHaveBeenCalled();
  });
});

describe('hydratePersistedAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsInitialized.mockReturnValue(true);
    mockHasInterrupted.mockResolvedValue(false);
    mockHasPersistedSession.mockResolvedValue(false);
    mockCompleteInterrupted.mockResolvedValue(undefined);
    mockRecordBootWipeFailure.mockResolvedValue(undefined);
  });

  it('sets authenticated from a persisted Welcome session', async () => {
    mockHasPersistedSession.mockResolvedValue(true);
    mockGetPubky.mockReturnValue('owner-pubky');
    mockGetHomeserver.mockReturnValue('homeserver-pk');

    await expect(hydratePersistedAuth()).resolves.toBe(true);
    expect(mockResetPaintOverlayForBoot).toHaveBeenCalled();
    expect(mockSetAuthenticated).toHaveBeenCalledWith('owner-pubky', 'homeserver-pk');
  });

  it('leaves auth cold when nothing is persisted', async () => {
    mockHasPersistedSession.mockResolvedValue(false);
    await expect(hydratePersistedAuth()).resolves.toBe(false);
    expect(mockSetAuthenticated).not.toHaveBeenCalled();
  });

  it('leaves auth cold when the keystore is not ready', async () => {
    mockIsInitialized.mockReturnValue(false);
    await expect(hydratePersistedAuth()).resolves.toBe(false);
    expect(mockHasPersistedSession).not.toHaveBeenCalled();
    expect(mockHasInterrupted).not.toHaveBeenCalled();
  });

  it('does not paint auth while an interrupted sign-out is still present', async () => {
    mockHasInterrupted.mockResolvedValue(true);
    mockHasPersistedSession.mockResolvedValue(true);
    mockGetPubky.mockReturnValue('owner-pubky');
    mockGetHomeserver.mockReturnValue('homeserver-pk');

    await expect(hydratePersistedAuth()).resolves.toBe(false);
    // App owns consumeInterruptedSignOutAtBoot — hydrate must not re-consume.
    expect(mockCompleteInterrupted).not.toHaveBeenCalled();
    expect(mockRecordBootWipeFailure).not.toHaveBeenCalled();
    expect(mockSetAuthenticated).not.toHaveBeenCalled();
  });

  it('records exactly one boot wipe failure when consume runs once', async () => {
    mockHasInterrupted.mockResolvedValue(true);
    mockCompleteInterrupted.mockRejectedValue(new Error('sql locked'));
    await expect(consumeInterruptedSignOutAtBoot()).resolves.toBe('wipe-failed');
    expect(mockRecordBootWipeFailure).toHaveBeenCalledTimes(1);
  });
});
