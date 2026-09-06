jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

import { GIF_STAGING_MAX_AGE_MS, gifStagingDirectory, sweepStaleGifStaging } from '../fileIo';

const mockedFs = jest.requireMock('expo-file-system/legacy') as {
  getInfoAsync: jest.Mock;
  readDirectoryAsync: jest.Mock;
  deleteAsync: jest.Mock;
};

describe('sweepStaleGifStaging', () => {
  const dir = gifStagingDirectory();
  const nowMs = 1_800_000_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.deleteAsync.mockResolvedValue(undefined);
  });

  it('deletes gif staging files older than one hour and keeps younger ones', async () => {
    mockedFs.getInfoAsync.mockImplementation(async (uri: string) => {
      if (uri === dir) return { exists: true, isDirectory: true };
      if (uri.endsWith('/old.gif')) {
        return {
          exists: true,
          isDirectory: false,
          modificationTime: (nowMs - GIF_STAGING_MAX_AGE_MS - 1000) / 1000,
        };
      }
      if (uri.endsWith('/fresh.gif')) {
        return {
          exists: true,
          isDirectory: false,
          modificationTime: (nowMs - 60_000) / 1000,
        };
      }
      return { exists: false, isDirectory: false };
    });
    mockedFs.readDirectoryAsync.mockResolvedValue(['old.gif', 'fresh.gif']);

    await sweepStaleGifStaging(nowMs);

    expect(mockedFs.deleteAsync).toHaveBeenCalledWith(`${dir}/old.gif`, { idempotent: true });
    expect(mockedFs.deleteAsync).not.toHaveBeenCalledWith(`${dir}/fresh.gif`, {
      idempotent: true,
    });
  });

  it('treats missing modificationTime as stale', async () => {
    mockedFs.getInfoAsync.mockImplementation(async (uri: string) => {
      if (uri === dir) return { exists: true, isDirectory: true };
      return { exists: true, isDirectory: false };
    });
    mockedFs.readDirectoryAsync.mockResolvedValue(['orphan.gif']);

    await sweepStaleGifStaging(nowMs);

    expect(mockedFs.deleteAsync).toHaveBeenCalledWith(`${dir}/orphan.gif`, { idempotent: true });
  });
});
