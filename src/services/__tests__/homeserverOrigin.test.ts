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

  it('falls back to the official staging origin when pkarr HTTPS is missing', async () => {
    mockGetHomeserver.mockResolvedValue({ isOk: () => false });
    mockGetStoredHomeserver.mockReturnValue('ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy');
    mockResolveHttps.mockResolvedValue({ isOk: () => false });
    await expect(resolveHomeserverOrigin('owner')).resolves.toBe(
      'https://homeserver.staging.pubky.app',
    );
  });
});
