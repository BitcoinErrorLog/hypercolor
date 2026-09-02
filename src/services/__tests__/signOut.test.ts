jest.mock('@synonymdev/react-native-pubky', () => ({
  signOut: jest.fn().mockResolvedValue({ isOk: () => true, value: undefined }),
  put: jest.fn(),
  get: jest.fn(),
  deleteFile: jest.fn(),
  list: jest.fn(),
  getHomeserver: jest.fn(),
  setEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

jest.mock('../link/LinkService', () => ({
  LinkService: {
    clearSession: jest.fn(),
  },
}));

jest.mock('../KeyStore', () => ({
  KeyStore: {
    getSessionSecret: jest.fn(() => 'session'),
    getPubky: jest.fn(() => 'a'.repeat(52)),
    isAppCertValid: jest.fn(),
    getAppKeypair: jest.fn(),
    clear: jest.fn(),
    clearIfPubky: jest.fn(),
    markSignOutIncomplete: jest.fn(),
    isSignOutIncomplete: jest.fn(() => false),
    getSignOutIncompleteOwner: jest.fn(() => null),
    clearSignOutIncomplete: jest.fn(),
  },
}));

jest.mock('../StorageService', () => ({
  StorageService: {
    persistSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    hasSignOutIncompleteJournal: jest.fn().mockResolvedValue(false),
    getSignOutIncompleteJournalOwner: jest.fn().mockResolvedValue(null),
    clearSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
  },
}));

import { KeyStore } from '../KeyStore';
import { LinkService } from '../link/LinkService';
import { PubkyService } from '../PubkyService';
import { StorageService } from '../StorageService';
import { activeOwnerAtCommit, paintOwner, SIGNING_OUT } from '../paintedOwner';

describe('sign-out teardown', () => {
  const callOrder: string[] = [];
  const owner = 'a'.repeat(52);

  beforeEach(() => {
    callOrder.length = 0;
    jest.mocked(LinkService.clearSession).mockImplementation(async () => {
      callOrder.push('teardown');
      expect(KeyStore.getPubky()).toBe(owner);
    });
    jest.mocked(KeyStore.clearIfPubky).mockImplementation(async expected => {
      callOrder.push('identity-clear');
      expect(expected).toBe(owner);
      return true;
    });
    jest.mocked(KeyStore.getSignOutIncompleteOwner).mockReturnValue(owner);
    paintOwner(owner);
  });

  it('runs LinkService teardown before clearing the current-owner identity', async () => {
    await PubkyService.signOut();
    expect(callOrder).toEqual(['teardown', 'identity-clear']);
    expect(LinkService.clearSession).toHaveBeenCalled();
    expect(KeyStore.clearIfPubky).toHaveBeenCalledWith(owner);
    const teardownOrder = jest.mocked(LinkService.clearSession).mock.invocationCallOrder[0]!;
    const identityOrder = jest.mocked(KeyStore.clearIfPubky).mock.invocationCallOrder[0]!;
    expect(teardownOrder).toBeLessThan(identityOrder);
  });

  it('restores the painted owner when teardown throws before wipe', async () => {
    jest.mocked(LinkService.clearSession).mockImplementationOnce(async () => {
      throw new Error('teardown');
    });
    await expect(PubkyService.signOut()).rejects.toThrow('teardown');
    expect(activeOwnerAtCommit()).toBe(owner);
    expect(KeyStore.clearIfPubky).not.toHaveBeenCalled();
  });

  it('does not restore paint when KeyStore.clearIfPubky throws after a successful teardown', async () => {
    jest.mocked(KeyStore.clearIfPubky).mockRejectedValueOnce(new Error('identity-clear'));
    await expect(PubkyService.signOut()).rejects.toThrow('identity-clear');
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
    expect(KeyStore.markSignOutIncomplete).toHaveBeenCalledWith(owner);
    expect(LinkService.clearSession).toHaveBeenCalled();
  });

  it('does not clear identity when the wipe reports an error', async () => {
    jest.mocked(LinkService.clearSession).mockImplementationOnce(async () => {
      throw new Error('sql locked');
    });
    await expect(PubkyService.signOut()).rejects.toThrow('sql locked');
    expect(KeyStore.clearIfPubky).not.toHaveBeenCalled();
    expect(StorageService.clearSignOutIncompleteJournal).not.toHaveBeenCalled();
    expect(activeOwnerAtCommit()).toBe(owner);
  });

  it('keeps a throwing interrupted-sign-out marker read inside the try', async () => {
    jest.mocked(KeyStore.isSignOutIncomplete).mockImplementation(() => {
      throw new Error('mmkv read');
    });
    await expect(PubkyService.hasInterruptedSignOut()).rejects.toThrow('mmkv read');
    jest.mocked(KeyStore.isSignOutIncomplete).mockReturnValue(false);
    jest.mocked(StorageService.hasSignOutIncompleteJournal).mockRejectedValueOnce(new Error('sql'));
    await expect(PubkyService.hasInterruptedSignOut()).rejects.toThrow('sql');
  });
});
