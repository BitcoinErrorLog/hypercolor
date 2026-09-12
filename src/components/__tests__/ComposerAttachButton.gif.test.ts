jest.mock('uuid', () => ({ v4: () => 'gif-uuid-1' }));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false, isDirectory: false }),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/gif/GifProxyClient', () => ({
  fetchGifBytes: jest.fn(),
}));

jest.mock('../../services/attachments/AttachmentService', () => ({
  AttachmentService: {
    sendAttachment: jest.fn(),
  },
}));

import { sendGifAttachment } from '../ComposerAttachButton';
import { fetchGifBytes } from '../../services/gif/GifProxyClient';
import { AttachmentService } from '../../services/attachments/AttachmentService';

const mockedFs = jest.requireMock('expo-file-system/legacy') as {
  cacheDirectory: string;
  writeAsStringAsync: jest.Mock;
  deleteAsync: jest.Mock;
  getInfoAsync: jest.Mock;
};

const GIF89A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

describe('sendGifAttachment staging', () => {
  const target = { type: 'conversation' as const, peerPubky: 'a'.repeat(52) };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.writeAsStringAsync.mockResolvedValue(undefined);
    mockedFs.deleteAsync.mockResolvedValue(undefined);
    jest.mocked(fetchGifBytes).mockResolvedValue({
      ok: true,
      bytes: GIF89A,
      contentType: 'image/gif',
    });
  });

  it('stages under cacheDirectory with a unique name and deletes on success', async () => {
    jest.mocked(AttachmentService.sendAttachment).mockResolvedValue({} as never);
    const result = await sendGifAttachment(target, 'ok1');
    expect(result).toEqual({ ok: true });
    const staged = mockedFs.writeAsStringAsync.mock.calls[0]?.[0] as string;
    expect(staged.startsWith('file:///cache/hypercolor-gif/')).toBe(true);
    expect(staged).toContain('gif-uuid-1');
    expect(staged.endsWith('.gif')).toBe(true);
    expect(mockedFs.deleteAsync).toHaveBeenCalledWith(staged, { idempotent: true });
    expect(mockedFs.getInfoAsync).toHaveBeenCalled();
  });

  it('deletes the staging file when send fails', async () => {
    jest.mocked(AttachmentService.sendAttachment).mockRejectedValue(new Error('send failed'));
    const result = await sendGifAttachment(target, 'ok1');
    expect(result.ok).toBe(false);
    const staged = mockedFs.writeAsStringAsync.mock.calls[0]?.[0] as string;
    expect(staged.startsWith('file:///cache/hypercolor-gif/')).toBe(true);
    expect(mockedFs.deleteAsync).toHaveBeenCalledWith(staged, { idempotent: true });
  });

  it('keeps send success when staging cleanup fails', async () => {
    jest.mocked(AttachmentService.sendAttachment).mockResolvedValue({} as never);
    mockedFs.deleteAsync.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(sendGifAttachment(target, 'ok1')).resolves.toEqual({ ok: true });
  });

  it('surfaces send failure when staging cleanup succeeds', async () => {
    jest.mocked(AttachmentService.sendAttachment).mockRejectedValue(new Error('send failed'));

    await expect(sendGifAttachment(target, 'ok1')).resolves.toEqual({
      ok: false,
      notice: { message: 'send failed' },
    });
  });
});
