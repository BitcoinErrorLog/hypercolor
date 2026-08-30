const mockGetHomeserver = jest.fn();
const mockResolveHttps = jest.fn();
const mockGetStoredHomeserver = jest.fn();

jest.mock('@synonymdev/react-native-pubky', () => ({
  getHomeserver: (...args: unknown[]) => mockGetHomeserver(...args),
  resolveHttps: (...args: unknown[]) => mockResolveHttps(...args),
}));

jest.mock('../KeyStore', () => ({
  KeyStore: {
    getHomeserver: (...args: unknown[]) => mockGetStoredHomeserver(...args),
  },
}));

import { parsePubkyOwner, resolveHomeserverOrigin } from '../homeserverOrigin';

describe('homeserverOrigin', () => {
  beforeEach(() => {
    mockGetHomeserver.mockReset();
    mockResolveHttps.mockReset();
    mockGetStoredHomeserver.mockReset();
  });

  it('parses the owner from a pubky URL', () => {
    expect(parsePubkyOwner('pubky://abc/pub/hypercolor.app/v1/backup/latest')).toBe('abc');
    expect(parsePubkyOwner('https://example.com/x')).toBeNull();
  });

  it('builds an HTTPS origin from a pkarr HTTPS record', async () => {
    mockGetHomeserver.mockResolvedValue({ isOk: () => true, value: 'homeserverpk' });
    mockGetStoredHomeserver.mockReturnValue(null);
    mockResolveHttps.mockResolvedValue({
      isOk: () => true,
      value: { public_key: 'homeserverpk', https_records: [{ target: 'hs.example.', port: 443 }] },
    });
    await expect(resolveHomeserverOrigin('owner')).resolves.toBe('https://hs.example');
  });
});
