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
  },
}));

import { KeyStore } from '../KeyStore';
import { LinkService } from '../link/LinkService';
import { PubkyService } from '../PubkyService';

describe('sign-out teardown', () => {
  const callOrder: string[] = [];

  beforeEach(() => {
    callOrder.length = 0;
    jest.mocked(LinkService.clearSession).mockImplementation(async () => {
      callOrder.push('teardown');
      expect(KeyStore.getPubky()).toBe('a'.repeat(52));
    });
    jest.mocked(KeyStore.clear).mockImplementation(async () => {
      callOrder.push('identity-clear');
    });
  });

  it('runs LinkService teardown before clearing the current-owner identity', async () => {
    await PubkyService.signOut();
    expect(callOrder).toEqual(['teardown', 'identity-clear']);
    expect(LinkService.clearSession).toHaveBeenCalled();
    expect(KeyStore.clear).toHaveBeenCalled();
    const teardownOrder = jest.mocked(LinkService.clearSession).mock.invocationCallOrder[0]!;
    const identityOrder = jest.mocked(KeyStore.clear).mock.invocationCallOrder[0]!;
    expect(teardownOrder).toBeLessThan(identityOrder);
  });
});
