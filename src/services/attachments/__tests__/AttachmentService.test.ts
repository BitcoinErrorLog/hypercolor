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
import { ATTACHMENT_MAX_BYTES } from '../../../flags/config';
import { LINK_MESSAGE_MAX_BYTES } from '../../../types/link';
import {
  ATTACHMENT_ALGORITHM,
  AttachmentError,
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
      EVENT_ID,
      expect.objectContaining({ key: MAIN_KEY, nonce: MAIN_NONCE }),
    );
    expect(mockedStorage.saveAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        keyRef: attachmentKeyRef(OWNER, EVENT_ID),
        localCachePath: `file:///cache/hypercolor-attachments/${OWNER}/${EVENT_ID}`,
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

  it('rejects files over the 8 MiB v1 cap before encrypt or upload', async () => {
    mockedFs.getInfoAsync.mockResolvedValue({
      exists: true,
      isDirectory: false,
      size: ATTACHMENT_MAX_BYTES + 1,
      uri: FILE_URI,
      modificationTime: 0,
    } as never);

    await expect(
      AttachmentService.sendAttachment(
        { type: 'conversation', peerPubky: PEER },
        FILE_URI,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ code: 'too-large' } satisfies Partial<AttachmentError>);
    expect(mockedNative.generateAttachmentKey).not.toHaveBeenCalled();
    expect(mockedPubky.put).not.toHaveBeenCalled();
    expect(mockedLink.sendPreparedMessage).not.toHaveBeenCalled();
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
      keyRef: attachmentKeyRef(OWNER, EVENT_ID),
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
      uri: `file:///cache/hypercolor-attachments/${OWNER}/${EVENT_ID}`,
    } as never);
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: MAIN_KEY,
      nonce: MAIN_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    mockedPubky.get.mockResolvedValue(MAIN_CT);
    mockedNative.attachmentDecrypt.mockResolvedValue(PLAIN_STD);

    const path = await AttachmentService.resolveAttachment(OWNER, EVENT_ID);

    expect(mockedPubky.get).toHaveBeenCalledWith(location());
    expect(mockedNative.attachmentDecrypt).toHaveBeenCalledWith(
      MAIN_CT,
      MAIN_KEY,
      MAIN_NONCE,
      location(),
    );
    expect(mockedFs.writeAsStringAsync).toHaveBeenCalled();
    expect(path).toBe(`file:///cache/hypercolor-attachments/${OWNER}/${EVENT_ID}`);
    expect(mockedStorage.updateAttachmentResolve).toHaveBeenCalledWith(
      OWNER,
      EVENT_ID,
      expect.objectContaining({ resolveState: 'ready', localCachePath: path }),
    );
  });

  it('does not re-download when a cache file already exists', async () => {
    const cachePath = `file:///cache/hypercolor-attachments/${OWNER}/${EVENT_ID}`;
    mockedStorage.getAttachment.mockResolvedValue({
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: 'received',
      location: location(),
      keyRef: attachmentKeyRef(OWNER, EVENT_ID),
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

    await expect(AttachmentService.resolveAttachment(OWNER, EVENT_ID)).resolves.toBe(cachePath);
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
      keyRef: attachmentKeyRef(OWNER, EVENT_ID),
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

    await expect(AttachmentService.resolveAttachment(OWNER, EVENT_ID)).rejects.toMatchObject({
      code: 'decrypt-failed',
    });
    expect(mockedStorage.updateAttachmentResolve).toHaveBeenCalledWith(OWNER, EVENT_ID, {
      resolveState: 'failed',
    });
  });

  it('rejects receiveAttachment on an unknown kind / malformed access message', async () => {
    await expect(AttachmentService.receiveAttachment('{"kind":"other.v0"}')).rejects.toMatchObject({
      code: 'validation',
    });
  });
});
