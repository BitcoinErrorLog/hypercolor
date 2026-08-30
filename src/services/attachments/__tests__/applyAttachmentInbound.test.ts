jest.mock('../../StorageService', () => ({
  StorageService: {
    hasLinkMessage: jest.fn(),
    hasAttachment: jest.fn(),
    saveAttachment: jest.fn(),
    saveLinkMessage: jest.fn(),
    hasGroupEvent: jest.fn(),
    getGroupChannel: jest.fn(),
    getGroupMember: jest.fn(),
    saveGroupMessage: jest.fn(),
    touchGroupChannel: jest.fn(),
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    setAttachmentSecret: jest.fn(),
  },
}));

import { StorageService } from '../../StorageService';
import { KeyStore } from '../../KeyStore';
import { applyAttachmentInbound, attachmentPreviewBody } from '../applyAttachmentInbound';
import {
  ATTACHMENT_ALGORITHM,
  CHAT_ATTACHMENT_KIND,
  attachmentKeyRef,
  buildAttachmentEnvelope,
  buildAttachmentLocation,
} from '../../../types/attachment';
import { buildDmConversationId } from '../../../types/link';

const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const ATTACHMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CHANNEL_ID = '00000000-0000-4000-8000-0000000000aa';
const NOW = 1_700_000_000_000;

const mockedStorage = jest.mocked(StorageService);
const mockedKeyStore = jest.mocked(KeyStore);

function accessJson(overrides: { channelId?: string } = {}): string {
  return buildAttachmentEnvelope({
    eventId: EVENT_ID,
    sentAt: NOW - 50,
    location: buildAttachmentLocation(PEER, ATTACHMENT_ID),
    key: 'A'.repeat(43),
    nonce: 'B'.repeat(32),
    algorithm: ATTACHMENT_ALGORITHM,
    contentType: 'image/jpeg',
    size: 12,
    ...(overrides.channelId ? { channelId: overrides.channelId } : {}),
  }).json;
}

describe('applyAttachmentInbound', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedStorage.hasLinkMessage.mockResolvedValue(false);
    mockedStorage.hasAttachment.mockResolvedValue(false);
    mockedStorage.hasGroupEvent.mockResolvedValue(false);
    mockedStorage.getGroupChannel.mockResolvedValue(null);
    mockedStorage.getGroupMember.mockResolvedValue(null);
  });

  it('persists DM metadata and KeyStore secrets without plaintext bytes', async () => {
    const rawJson = accessJson();
    const row = await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson,
      receivedAt: NOW,
    });

    expect(row).toEqual(
      expect.objectContaining({
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: buildDmConversationId(PEER),
        kind: CHAT_ATTACHMENT_KIND,
        body: attachmentPreviewBody({ contentType: 'image/jpeg', size: 12 }),
      }),
    );
    expect(mockedKeyStore.setAttachmentSecret).toHaveBeenCalledWith(
      OWNER,
      EVENT_ID,
      expect.objectContaining({ key: 'A'.repeat(43), nonce: 'B'.repeat(32) }),
    );
    expect(mockedStorage.saveAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        keyRef: attachmentKeyRef(OWNER, EVENT_ID),
        localCachePath: null,
        location: buildAttachmentLocation(PEER, ATTACHMENT_ID),
      }),
    );
    expect(mockedStorage.saveLinkMessage).toHaveBeenCalled();
  });

  it('dedups an already-stored DM attachment', async () => {
    mockedStorage.hasLinkMessage.mockResolvedValue(true);
    const row = await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: accessJson(),
      receivedAt: NOW,
    });
    expect(row).toBeNull();
    expect(mockedStorage.saveAttachment).not.toHaveBeenCalled();
    expect(mockedKeyStore.setAttachmentSecret).not.toHaveBeenCalled();
  });

  it('returns null for a malformed known-kind payload', async () => {
    const row = await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: JSON.stringify({ version: 1, kind: CHAT_ATTACHMENT_KIND, event_id: 'bad' }),
      receivedAt: NOW,
    });
    expect(row).toBeNull();
    expect(mockedStorage.saveAttachment).not.toHaveBeenCalled();
  });

  it('ignores a group attachment for an unknown or public channel', async () => {
    mockedStorage.getGroupChannel.mockResolvedValueOnce(null);
    await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: accessJson({ channelId: CHANNEL_ID }),
      receivedAt: NOW,
    });
    expect(mockedStorage.saveAttachment).not.toHaveBeenCalled();

    mockedStorage.getGroupChannel.mockResolvedValueOnce({
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      name: 'Public',
      createdAt: 1,
      updatedAt: 1,
      createdBy: OWNER,
      isPublic: true,
      lastMessageAt: 1,
      membershipEpoch: 0,
    });
    await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: accessJson({ channelId: CHANNEL_ID }),
      receivedAt: NOW,
    });
    expect(mockedStorage.saveAttachment).not.toHaveBeenCalled();
  });

  it('persists a private-group attachment only for an active member', async () => {
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
    mockedStorage.getGroupMember.mockResolvedValue({
      ownerPubky: OWNER,
      channelId: CHANNEL_ID,
      memberPubky: PEER,
      role: 'member',
      addedAt: 1,
      removedAt: null,
      status: 'active',
    });

    const row = await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: accessJson({ channelId: CHANNEL_ID }),
      receivedAt: NOW,
    });

    expect(row).toBeNull();
    expect(mockedStorage.saveAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL_ID, conversationId: null }),
    );
    expect(mockedStorage.saveGroupMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: CHAT_ATTACHMENT_KIND, eventId: EVENT_ID }),
    );
  });
});
