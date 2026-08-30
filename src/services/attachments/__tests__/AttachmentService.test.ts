jest.mock('uuid', () => ({ v4: jest.fn() }));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('../../link/PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateAttachmentKey: jest.fn(),
    attachmentEncrypt: jest.fn(),
    attachmentDecrypt: jest.fn(),
  },
  isLinkNativeError: (err: unknown) =>
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string',
}));

jest.mock('../../PubkyService', () => ({
  PubkyService: {
    put: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    setAttachmentSecret: jest.fn(),
    getAttachmentSecret: jest.fn(),
  },
}));

jest.mock('../../StorageService', () => ({
  StorageService: {
    getGroupChannel: jest.fn(),
    saveAttachment: jest.fn(),
    updateAttachmentDelivery: jest.fn(),
    updateAttachmentResolve: jest.fn(),
    getAttachment: jest.fn(),
  },
}));

jest.mock('../../link/LinkService', () => ({
  LinkService: {
    sendPreparedMessage: jest.fn(),
  },
}));

jest.mock('../../group/GroupService', () => ({
  GroupService: {
    sendPreparedFanout: jest.fn(),
  },
}));

import { v4 as uuidv4 } from 'uuid';
import { manipulateAsync } from 'expo-image-manipulator';
import {
  ATTACHMENT_CIPHERTEXT_MAX_CHARS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_THUMBNAIL_CIPHERTEXT_MAX_CHARS,
} from '../../../flags/config';
import { LINK_MESSAGE_MAX_BYTES } from '../../../types/link';
import {
  ATTACHMENT_ALGORITHM,
  CHAT_ATTACHMENT_KIND,
  attachmentKeyRef,
  buildAttachmentLocation,
  buildAttachmentThumbLocation,
} from '../../../types/attachment';
import { PaykitLinkNative } from '../../link/PaykitLinkNative';
import { PubkyService } from '../../PubkyService';
import { KeyStore } from '../../KeyStore';
import { StorageService } from '../../StorageService';
import { LinkService } from '../../link/LinkService';
import { GroupService } from '../../group/GroupService';
import { AttachmentService } from '../AttachmentService';

const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const ATTACHMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const CHANNEL_ID = '00000000-0000-4000-8000-0000000000aa';
const FILE_URI = 'file:///tmp/photo.jpg';
const PLAIN_STD = 'cGxhaW50ZXh0';
const MAIN_KEY = 'K'.repeat(43);
const MAIN_NONCE = 'N'.repeat(32);
const MAIN_CT = 'C'.repeat(40);
const THUMB_KEY = 'T'.repeat(43);
const THUMB_NONCE = 'U'.repeat(32);
const THUMB_CT = 'V'.repeat(24);

const mockedUuid = uuidv4 as jest.Mock;
const mockedFs = jest.requireMock('expo-file-system/legacy') as {
  getInfoAsync: jest.Mock;
  readAsStringAsync: jest.Mock;
  writeAsStringAsync: jest.Mock;
  makeDirectoryAsync: jest.Mock;
  deleteAsync: jest.Mock;
};
const mockedNative = jest.mocked(PaykitLinkNative);
const mockedPubky = jest.mocked(PubkyService);
const mockedKeyStore = jest.mocked(KeyStore);
const mockedStorage = jest.mocked(StorageService);
const mockedLink = jest.mocked(LinkService);
const mockedGroup = jest.mocked(GroupService);
const mockedManipulate = jest.mocked(manipulateAsync);

function location(): string {
  return buildAttachmentLocation(OWNER, ATTACHMENT_ID);
}

describe('AttachmentService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockedUuid.mockReturnValueOnce(ATTACHMENT_ID).mockReturnValue(EVENT_ID);
    mockedKeyStore.getPubky.mockReturnValue(OWNER);
    mockedNative.isAvailable.mockReturnValue(true);
    mockedNative.generateAttachmentKey.mockResolvedValue(MAIN_KEY);
    mockedNative.attachmentEncrypt.mockResolvedValue({
      nonceB64: MAIN_NONCE,
      ciphertextB64: MAIN_CT,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    mockedPubky.put.mockResolvedValue(undefined);
    mockedLink.sendPreparedMessage.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent',
      kind: CHAT_ATTACHMENT_KIND,
      rawJson: '{}',
      body: '[attachment]',
      sentAt: 1_700_000_000_000,
      receivedAt: null,
      deliveryState: 'sent',
    });
    mockedGroup.sendPreparedFanout.mockResolvedValue({
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      eventId: EVENT_ID,
      senderPubky: OWNER,
      kind: CHAT_ATTACHMENT_KIND,
      body: '[attachment]',
      rawJson: '{}',
      sentAt: 1_700_000_000_000,
      receivedAt: null,
      deliveryState: 'sent',
      replyToEventId: null,
      replyToAuthorPubky: null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: true,
      isDirectory: false,
      size: 9,
      uri: FILE_URI,
      modificationTime: 0,
    } as never);
    mockedFs.readAsStringAsync.mockResolvedValue(PLAIN_STD);
    mockedFs.makeDirectoryAsync.mockResolvedValue(undefined);
    mockedFs.writeAsStringAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encrypts with path AAD, uploads ciphertext, and sends a budget-safe access PAM', async () => {
    const record = await AttachmentService.sendAttachment(
      { type: 'conversation', peerPubky: PEER },
      FILE_URI,
      'application/pdf',
    );

    expect(mockedNative.generateAttachmentKey).toHaveBeenCalledTimes(1);
    expect(mockedNative.attachmentEncrypt).toHaveBeenCalledWith(PLAIN_STD, MAIN_KEY, location());
    expect(mockedPubky.put).toHaveBeenCalledWith(location(), MAIN_CT);
    expect(mockedLink.sendPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        peerPubky: PEER,
        kind: CHAT_ATTACHMENT_KIND,
        eventId: EVENT_ID,
      }),
    );
    const sent = mockedLink.sendPreparedMessage.mock.calls[0]![0];
    const parsed = JSON.parse(sent.rawJson) as Record<string, unknown>;
    expect(parsed).toEqual(
      expect.objectContaining({
        version: 1,
        kind: CHAT_ATTACHMENT_KIND,
        location: location(),
        key: MAIN_KEY,
        nonce: MAIN_NONCE,
        algorithm: ATTACHMENT_ALGORITHM,
        contentType: 'application/pdf',
        size: 9,
      }),
    );
    expect(new TextEncoder().encode(sent.rawJson).byteLength).toBeLessThanOrEqual(
      LINK_MESSAGE_MAX_BYTES,
    );
    expect(mockedKeyStore.setAttachmentSecret).toHaveBeenCalledWith(
      OWNER,
      OWNER,
      EVENT_ID,
      expect.objectContaining({ key: MAIN_KEY, nonce: MAIN_NONCE }),
    );
    expect(mockedStorage.saveAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        keyRef: attachmentKeyRef(OWNER, OWNER, EVENT_ID),
        localCachePath: `file:///cache/hypercolor-attachments/${OWNER}/${OWNER}/${EVENT_ID}`,
        location: location(),
      }),
    );
    expect(record.deliveryState).toBe('sent');
    expect(manipulateAsync).not.toHaveBeenCalled();
  });

  it('encrypts and uploads an image thumbnail when it fits the byte budget', async () => {
    mockedNative.generateAttachmentKey.mockReset();
    mockedNative.generateAttachmentKey
      .mockResolvedValueOnce(MAIN_KEY)
      .mockResolvedValueOnce(THUMB_KEY);
    mockedNative.attachmentEncrypt.mockReset();
    mockedNative.attachmentEncrypt
      .mockResolvedValueOnce({
        nonceB64: MAIN_NONCE,
        ciphertextB64: MAIN_CT,
        algorithm: ATTACHMENT_ALGORITHM,
      })
      .mockResolvedValueOnce({
        nonceB64: THUMB_NONCE,
        ciphertextB64: THUMB_CT,
        algorithm: ATTACHMENT_ALGORITHM,
      });
    mockedManipulate.mockResolvedValue({
      uri: 'file:///tmp/thumb.jpg',
      width: 96,
      height: 96,
      base64: 'dGh1bWI=',
    });

    await AttachmentService.sendAttachment(
      { type: 'conversation', peerPubky: PEER },
      FILE_URI,
      'image/jpeg',
    );

    const thumbLocation = buildAttachmentThumbLocation(OWNER, ATTACHMENT_ID);
    expect(mockedNative.attachmentEncrypt).toHaveBeenNthCalledWith(
      2,
      'dGh1bWI',
      THUMB_KEY,
      thumbLocation,
    );
    expect(mockedPubky.put).toHaveBeenCalledWith(thumbLocation, THUMB_CT);
    const sent = mockedLink.sendPreparedMessage.mock.calls[0]![0];
    const parsed = JSON.parse(sent.rawJson) as { thumbnail?: { location: string } };
    expect(parsed.thumbnail?.location).toBe(thumbLocation);
    expect(new TextEncoder().encode(sent.rawJson).byteLength).toBeLessThanOrEqual(
      LINK_MESSAGE_MAX_BYTES,
    );
  });

  it('uses decoded bytes for size, not filesystem metadata', async () => {
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: true,
      isDirectory: false,
      size: ATTACHMENT_MAX_BYTES + 1,
      uri: FILE_URI,
      modificationTime: 0,
    } as never);

    const record = await AttachmentService.sendAttachment(
      { type: 'conversation', peerPubky: PEER },
      FILE_URI,
      'application/pdf',
    );
    expect(record.size).toBe(9);
    expect(mockedLink.sendPreparedMessage).toHaveBeenCalled();
  });

  it('propagates queued delivery instead of lying that the PAM was sent', async () => {
    mockedLink.sendPreparedMessage.mockResolvedValueOnce({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: 'sent',
      kind: CHAT_ATTACHMENT_KIND,
      rawJson: '{}',
      body: '[attachment]',
      sentAt: 1_700_000_000_000,
      receivedAt: null,
      deliveryState: 'sending',
    });

    const record = await AttachmentService.sendAttachment(
      { type: 'conversation', peerPubky: PEER },
      FILE_URI,
      'application/pdf',
    );
    expect(record.deliveryState).toBe('sending');
    expect(mockedStorage.updateAttachmentDelivery).toHaveBeenCalledWith(
      OWNER,
      OWNER,
      EVENT_ID,
      'sending',
    );
  });

  it('rejects public-channel and unknown-channel targets', async () => {
    mockedStorage.getGroupChannel.mockResolvedValueOnce({
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      name: 'Town',
      createdAt: 1,
      updatedAt: 1,
      createdBy: OWNER,
      isPublic: true,
      lastMessageAt: 1,
      membershipEpoch: 0,
    });
    await expect(
      AttachmentService.sendAttachment(
        { type: 'channel', channelId: CHANNEL_ID },
        FILE_URI,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ code: 'unsupported-target' });

    mockedStorage.getGroupChannel.mockResolvedValueOnce(null);
    await expect(
      AttachmentService.sendAttachment(
        { type: 'channel', channelId: CHANNEL_ID },
        FILE_URI,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(mockedPubky.put).not.toHaveBeenCalled();
  });

  it('fans a private-channel attachment out over Encrypted Links', async () => {
    mockedStorage.getGroupChannel.mockResolvedValue({
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      name: 'Crew',
      createdAt: 1,
      updatedAt: 1,
      createdBy: OWNER,
      isPublic: false,
      lastMessageAt: 1,
      membershipEpoch: 0,
    });

    await AttachmentService.sendAttachment(
      { type: 'channel', channelId: CHANNEL_ID },
      FILE_URI,
      'application/pdf',
    );

    expect(mockedGroup.sendPreparedFanout).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: CHANNEL_ID,
        kind: CHAT_ATTACHMENT_KIND,
        eventId: EVENT_ID,
      }),
    );
    expect(mockedLink.sendPreparedMessage).not.toHaveBeenCalled();
  });

  it('downloads, decrypts with matching AAD, and caches plaintext on resolve', async () => {
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
      contentType: 'application/pdf',
      size: 9,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: false,
      isDirectory: false,
      uri: `file:///cache/hypercolor-attachments/${OWNER}/${PEER}/${EVENT_ID}`,
    } as never);
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: MAIN_KEY,
      nonce: MAIN_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    mockedPubky.get.mockResolvedValue(MAIN_CT);
    mockedNative.attachmentDecrypt.mockResolvedValue(PLAIN_STD);

    const path = await AttachmentService.resolveAttachment(OWNER, PEER, EVENT_ID);

    expect(mockedPubky.get).toHaveBeenCalledWith(location());
    expect(mockedNative.attachmentDecrypt).toHaveBeenCalledWith(
      MAIN_CT,
      MAIN_KEY,
      MAIN_NONCE,
      location(),
    );
    expect(mockedFs.writeAsStringAsync).toHaveBeenCalled();
    expect(path).toBe(`file:///cache/hypercolor-attachments/${OWNER}/${PEER}/${EVENT_ID}`);
    expect(mockedStorage.updateAttachmentResolve).toHaveBeenCalledWith(
      OWNER,
      PEER,
      EVENT_ID,
      expect.objectContaining({ resolveState: 'ready', localCachePath: path }),
    );
  });

  it('does not re-download when a cache file already exists', async () => {
    const cachePath = `file:///cache/hypercolor-attachments/${OWNER}/${PEER}/${EVENT_ID}`;
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
      contentType: 'application/pdf',
      size: 9,
      thumbnailLocation: null,
      localCachePath: cachePath,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'delivered',
      resolveState: 'ready',
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: true,
      isDirectory: false,
      size: 9,
      uri: cachePath,
      modificationTime: 0,
    } as never);

    await expect(AttachmentService.resolveAttachment(OWNER, PEER, EVENT_ID)).resolves.toBe(
      cachePath,
    );
    expect(mockedPubky.get).not.toHaveBeenCalled();
    expect(mockedNative.attachmentDecrypt).not.toHaveBeenCalled();
  });

  it('maps a native protocol decrypt failure to decrypt-failed', async () => {
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
      contentType: 'application/pdf',
      size: 9,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: false,
      isDirectory: false,
      uri: 'x',
    } as never);
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: MAIN_KEY,
      nonce: MAIN_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    mockedPubky.get.mockResolvedValue(MAIN_CT);
    mockedNative.attachmentDecrypt.mockRejectedValue({
      code: 'protocol',
      message: 'decrypt_failed',
    });

    await expect(AttachmentService.resolveAttachment(OWNER, PEER, EVENT_ID)).rejects.toMatchObject({
      code: 'decrypt-failed',
    });
    expect(mockedStorage.updateAttachmentResolve).toHaveBeenCalledWith(OWNER, PEER, EVENT_ID, {
      resolveState: 'failed',
    });
  });

  it('rejects receiveAttachment on an unknown kind / malformed access message', async () => {
    await expect(AttachmentService.receiveAttachment('{"kind":"other.v0"}')).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('aborts an oversized actual download before decrypt', async () => {
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
      contentType: 'application/pdf',
      size: 9,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: false,
      isDirectory: false,
      uri: 'x',
    } as never);
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: MAIN_KEY,
      nonce: MAIN_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    mockedPubky.get.mockResolvedValue('C'.repeat(ATTACHMENT_CIPHERTEXT_MAX_CHARS + 1));

    await expect(AttachmentService.resolveAttachment(OWNER, PEER, EVENT_ID)).rejects.toMatchObject({
      code: 'too-large',
    });
    expect(mockedNative.attachmentDecrypt).not.toHaveBeenCalled();
    expect(mockedFs.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('rejects an over-limit declared size before any download', async () => {
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
      contentType: 'application/pdf',
      size: ATTACHMENT_MAX_BYTES + 1,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: false,
      isDirectory: false,
      uri: 'x',
    } as never);

    await expect(AttachmentService.resolveAttachment(OWNER, PEER, EVENT_ID)).rejects.toMatchObject({
      code: 'too-large',
    });
    expect(mockedPubky.get).not.toHaveBeenCalled();
    expect(mockedKeyStore.getAttachmentSecret).not.toHaveBeenCalled();
    expect(mockedNative.attachmentDecrypt).not.toHaveBeenCalled();
  });

  it('rejects a decrypted-length mismatch and does not cache', async () => {
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
      contentType: 'application/pdf',
      size: 9,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: false,
      isDirectory: false,
      uri: 'x',
    } as never);
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: MAIN_KEY,
      nonce: MAIN_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    mockedPubky.get.mockResolvedValue(MAIN_CT);
    mockedNative.attachmentDecrypt.mockResolvedValue('QQ'); // 1 decoded byte, not 9

    await expect(AttachmentService.resolveAttachment(OWNER, PEER, EVENT_ID)).rejects.toMatchObject({
      code: 'protocol',
    });
    expect(mockedFs.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('enforces the thumbnail ciphertext cap and does not write a cache file', async () => {
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
      contentType: 'image/jpeg',
      size: 9,
      thumbnailLocation: `${location()}.thumb`,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'delivered',
      resolveState: 'pending',
    });
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: MAIN_KEY,
      nonce: MAIN_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
      thumbnail: { key: THUMB_KEY, nonce: THUMB_NONCE },
    });
    mockedPubky.get.mockResolvedValue('V'.repeat(ATTACHMENT_THUMBNAIL_CIPHERTEXT_MAX_CHARS + 1));

    await expect(AttachmentService.resolveThumbnail(OWNER, PEER, EVENT_ID)).resolves.toBeNull();
    expect(mockedNative.attachmentDecrypt).not.toHaveBeenCalled();
    expect(mockedFs.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('makes the decrypt mock enforce AAD equality rather than echo', async () => {
    let sealedAad = '';
    mockedNative.attachmentEncrypt.mockImplementation(async (_pt, _key, aad) => {
      sealedAad = String(aad ?? '');
      return { nonceB64: MAIN_NONCE, ciphertextB64: MAIN_CT, algorithm: ATTACHMENT_ALGORITHM };
    });
    mockedNative.attachmentDecrypt.mockImplementation(async (_ct, _key, _nonce, aad) => {
      if (aad !== sealedAad) {
        throw { code: 'protocol', message: 'aad mismatch' };
      }
      return PLAIN_STD;
    });

    await AttachmentService.sendAttachment(
      { type: 'conversation', peerPubky: PEER },
      FILE_URI,
      'application/pdf',
    );
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: OWNER,
      direction: 'sent',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, OWNER, EVENT_ID),
      contentType: 'application/pdf',
      size: 9,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: 'sent',
      resolveState: 'pending',
    });
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: false,
      isDirectory: false,
      uri: 'x',
    } as never);
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: MAIN_KEY,
      nonce: MAIN_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    mockedPubky.get.mockResolvedValue(MAIN_CT);

    await expect(AttachmentService.resolveAttachment(OWNER, OWNER, EVENT_ID)).resolves.toBe(
      `file:///cache/hypercolor-attachments/${OWNER}/${OWNER}/${EVENT_ID}`,
    );

    mockedNative.attachmentDecrypt.mockImplementation(async (_ct, _key, _nonce, aad) => {
      if (aad !== sealedAad) {
        throw { code: 'protocol', message: 'aad mismatch' };
      }
      return PLAIN_STD;
    });
    await expect(
      mockedNative.attachmentDecrypt(MAIN_CT, MAIN_KEY, MAIN_NONCE, 'pubky://wrong/path'),
    ).rejects.toMatchObject({ message: 'aad mismatch' });
  });
});
