const mockHasPersistedSession = jest.fn();
const mockGetPubky = jest.fn();
const mockGetHomeserver = jest.fn();
const mockSetAuthenticated = jest.fn();

jest.mock('../../services/KeyStore', () => ({
  KeyStore: {
    hasPersistedSession: (...args: unknown[]) => mockHasPersistedSession(...args),
    getPubky: (...args: unknown[]) => mockGetPubky(...args),
    getHomeserver: (...args: unknown[]) => mockGetHomeserver(...args),
  },
}));

jest.mock('../authStore', () => ({
  useAuthStore: {
    getState: () => ({ setAuthenticated: mockSetAuthenticated }),
  },
}));

import { hydratePersistedAuth } from '../hydrateAuthSession';

describe('hydratePersistedAuth', () => {
  beforeEach(() => {
    mockHasPersistedSession.mockReset();
    mockGetPubky.mockReset();
    mockGetHomeserver.mockReset();
    mockSetAuthenticated.mockReset();
  });

  it('sets authenticated from a persisted Welcome session', async () => {
    mockHasPersistedSession.mockResolvedValue(true);
    mockGetPubky.mockReturnValue('owner-pubky');
    mockGetHomeserver.mockReturnValue('homeserver-pk');

    await expect(hydratePersistedAuth()).resolves.toBe(true);
    expect(mockSetAuthenticated).toHaveBeenCalledWith('owner-pubky', 'homeserver-pk');
  });

  it('leaves auth cold when nothing is persisted', async () => {
    mockHasPersistedSession.mockResolvedValue(false);
    await expect(hydratePersistedAuth()).resolves.toBe(false);
    expect(mockSetAuthenticated).not.toHaveBeenCalled();
  });
});
