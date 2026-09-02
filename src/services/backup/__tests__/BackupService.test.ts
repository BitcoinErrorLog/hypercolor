jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the backup SQL harness');
  },
}));

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

jest.mock('../../link/PaykitLinkNative', () => ({
  PaykitLinkNative: {
    generateAttachmentKey: jest.fn(),
    attachmentEncrypt: jest.fn(),
    attachmentDecrypt: jest.fn(),
  },
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
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { CHAT_MESSAGE_KIND } from '../../../types/link';
import { EMPTY_PAYMENT_RECORD_EXTRAS } from '../../../types/payment';
import { KeyStore } from '../../KeyStore';
import { PaykitLinkNative } from '../../link/PaykitLinkNative';
import { PubkyService } from '../../PubkyService';
import { StorageService } from '../../StorageService';
import { clearPaintedOwner, paintOwner } from '../../paintedOwner';
import { backupLatestUrl, BackupService, OWNER_BACKUP_VERSION } from '../BackupService';
import type { OwnerBackupSnapshot } from '../snapshot';

const OWNER = 'a'.repeat(52);
const PEER = 'z'.repeat(52);
const OTHER = 'b'.repeat(52);
const EVENT = '00000000-0000-4000-8000-000000000001';
const RECOVERY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedPubky = jest.mocked(PubkyService);
const mockedKeyStore = jest.mocked(KeyStore);

const uploaded = new Map<string, string>();
const encryptCalls: Array<{ plaintextB64: string; key: string; aad: string | null }> = [];

async function openHarness(): Promise<void> {
  const db = openMemoryDb();
  setDbForTests(db);
  await runMigrations(db);
  mockedKeyStore.getPubky.mockReturnValue(OWNER);
  paintOwner(OWNER);
}

async function seedOwnerAndForeign(): Promise<void> {
  await StorageService.upsertContact({
    pubky: PEER,
    ownerPubky: OWNER,
    displayName: 'Peer',
    trustScore: 0.5,
    isFollowing: true,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: 10,
  });
  paintOwner(OTHER);
  await StorageService.upsertContact({
    pubky: PEER,
    ownerPubky: OTHER,
    displayName: 'Foreign',
    trustScore: 0.9,
    isFollowing: false,
    isFollower: true,
    isMutual: false,
    addedManually: false,
    firstSeenAt: 11,
  });
  paintOwner(OWNER);
  await StorageService.saveLinkMessage({
    ownerPubky: OWNER,
    eventId: EVENT,
    conversationId: `dm:${PEER}`,
    peerPubky: PEER,
    senderPubky: OWNER,
    direction: 'sent',
    kind: CHAT_MESSAGE_KIND,
    rawJson: '{}',
    body: 'hello from owner',
    sentAt: 20,
    receivedAt: null,
    deliveryState: 'sent',
  });
  paintOwner(OTHER);
  await StorageService.saveLinkMessage({
    ownerPubky: OTHER,
    eventId: EVENT,
    conversationId: `dm:${PEER}`,
    peerPubky: PEER,
    senderPubky: OTHER,
    direction: 'sent',
    kind: CHAT_MESSAGE_KIND,
    rawJson: '{}',
    body: 'foreign body',
    sentAt: 21,
    receivedAt: null,
    deliveryState: 'sent',
  });
  paintOwner(OWNER);
  await StorageService.setLinkReadCursor(OWNER, `dm:${PEER}`, 20);
  await StorageService.saveAttachment({
    ownerPubky: OWNER,
    eventId: EVENT,
    conversationId: `dm:${PEER}`,
    channelId: null,
    senderPubky: OWNER,
    direction: 'sent',
    location: `pubky://${OWNER}/pub/hypercolor.app/v1/attachments/${EVENT}`,
    keyRef: `att:${OWNER}:${OWNER}:${EVENT}`,
    contentType: 'image/jpeg',
    size: 12,
    thumbnailLocation: null,
    localCachePath: 'file:///cache/secret',
    createdAt: 20,
    updatedAt: 20,
    deliveryState: 'sent',
    resolveState: 'ready',
  });
  await StorageService.savePaymentRequest({
    ownerPubky: OWNER,
    peerPubky: PEER,
    direction: 'sent',
    paymentRequestId: 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
    eventId: EVENT,
    amountValue: '0.001',
    amountAsset: 'btc',
    paymentReference: 'backup-ref',
    endpointIds: ['btc-lightning-bolt11'],
    expiresAt: null,
    status: 'pending',
    createdAt: 20,
    updatedAt: 20,
    proofJson: null,
    reason: null,
    ...EMPTY_PAYMENT_RECORD_EXTRAS,
  });
}

describe('BackupService', () => {
  beforeEach(() => {
    uploaded.clear();
    encryptCalls.length = 0;
    mockedNative.generateAttachmentKey.mockResolvedValue(RECOVERY);
    mockedNative.attachmentEncrypt.mockImplementation(async (plaintextB64, key, aad) => {
      encryptCalls.push({ plaintextB64, key, aad: aad ?? null });
      return {
        algorithm: 'XChaCha20Poly1305',
        nonceB64: 'nonce-b64',
        ciphertextB64: `ct:${plaintextB64}`,
      };
    });
    mockedNative.attachmentDecrypt.mockImplementation(async (ciphertextB64, _key, _nonce, aad) => {
      if (aad !== backupLatestUrl(OWNER)) {
        throw new Error(`AAD mismatch: ${String(aad)}`);
      }
      if (!ciphertextB64.startsWith('ct:')) throw new Error('unexpected ciphertext');
      return ciphertextB64.slice(3);
    });
    mockedPubky.put.mockImplementation(async (url, content) => {
      uploaded.set(url, content);
    });
    mockedPubky.get.mockImplementation(async url => uploaded.get(url) ?? null);
  });

  afterEach(() => {
    setDbForTests(null);
    clearPaintedOwner();
  });

  it('export collects owner-scoped rows only and strips attachment secrets', async () => {
    await openHarness();
    await seedOwnerAndForeign();

    const snapshot = await StorageService.collectOwnerBackup(OWNER);
    expect(snapshot.version).toBe(OWNER_BACKUP_VERSION);
    expect(snapshot.ownerPubky).toBe(OWNER);
    expect(snapshot.contacts.map(c => c.ownerPubky)).toEqual([OWNER]);
    expect(snapshot.contacts.map(c => c.displayName)).toEqual(['Peer']);
    expect(snapshot.linkMessages.map(m => m.body)).toEqual(['hello from owner']);
    expect(snapshot.readCursors).toEqual([{ conversationId: `dm:${PEER}`, lastReadAt: 20 }]);
    expect(snapshot.attachments).toEqual([
      expect.objectContaining({
        eventId: EVENT,
        keyRef: '',
        localCachePath: null,
        resolveState: 'unavailable-from-backup',
      }),
    ]);
    expect(snapshot.paymentRequests).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('att:');
    expect(JSON.stringify(snapshot)).not.toContain('file:///cache/secret');
    expect(JSON.stringify(snapshot)).not.toContain('foreign body');
  });

  it('encrypts and uploads with AAD bound to the backup path', async () => {
    await openHarness();
    await seedOwnerAndForeign();

    const result = await BackupService.exportBackup();
    expect(result.recoveryCode).toBe(RECOVERY);
    expect(result.path).toBe(backupLatestUrl(OWNER));
    expect(encryptCalls).toEqual([
      expect.objectContaining({
        key: RECOVERY,
        aad: backupLatestUrl(OWNER),
      }),
    ]);
    expect(mockedPubky.put).toHaveBeenCalledWith(
      backupLatestUrl(OWNER),
      expect.stringContaining('"ciphertextB64"'),
    );
    const blob = JSON.parse(uploaded.get(backupLatestUrl(OWNER)) ?? '{}') as {
      version: number;
      nonceB64: string;
    };
    expect(blob.version).toBe(1);
    expect(blob.nonceB64).toBe('nonce-b64');
  });

  it('export re-redacts legacy raw_json that still carries live attachment keys', async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    mockedKeyStore.getPubky.mockReturnValue(OWNER);

    const liveKey = 'K'.repeat(43);
    const liveNonce = 'N'.repeat(32);
    const attachmentId = '11111111-2222-4333-8444-555555555555';
    const liveJson = JSON.stringify({
      version: 1,
      kind: 'chat.attachment.v0',
      event_id: EVENT,
      sent_at: 20,
      location: `pubky://${OWNER}/pub/hypercolor.app/v1/attachments/${attachmentId}`,
      key: liveKey,
      nonce: liveNonce,
      algorithm: 'XChaCha20Poly1305',
      contentType: 'image/jpeg',
      size: 12,
    });
    // Simulate rows written before M4 redaction-at-persist (raw SQL bypasses
    // the persistRawJson redaction that saveLinkMessage/saveGroupMessage apply).
    db.executeSync(
      `INSERT INTO link_messages
        (owner_pubky, sender_pubky, kind, event_id, conversation_id, peer_pubky,
         direction, raw_json, body, sent_at, received_at, delivery_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        OWNER,
        PEER,
        'chat.attachment.v0',
        EVENT,
        `dm:${PEER}`,
        PEER,
        'received',
        liveJson,
        '[attachment]',
        20,
        20,
        'delivered',
        20,
        20,
      ],
    );
    db.executeSync(
      `INSERT INTO group_messages
        (owner_pubky, channel_id, sender_pubky, event_id, kind, body, raw_json,
         sent_at, received_at, delivery_state, reply_to_event_id, reply_to_author_pubky,
         target_event_id, target_author_pubky, edited_at, deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        OWNER,
        `${PEER}:${attachmentId}`,
        PEER,
        EVENT,
        'chat.attachment.v0',
        '[attachment]',
        liveJson,
        20,
        20,
        'delivered',
        null,
        null,
        null,
        null,
        null,
        0,
        20,
        20,
      ],
    );

    const snapshot = await StorageService.collectOwnerBackup(OWNER);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(liveKey);
    expect(serialized).not.toContain(liveNonce);
    expect(serialized).toContain('__keystore__');
  });

  it('restore round-trips via mocked AEAD and real SQL', async () => {
    await openHarness();
    await seedOwnerAndForeign();
    await BackupService.exportBackup();

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.getContact(PEER, OWNER)).toBeNull();
    expect(await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`)).toEqual([]);

    await BackupService.restoreBackup(RECOVERY);

    expect(await StorageService.getContact(PEER, OWNER)).toEqual(
      expect.objectContaining({ displayName: 'Peer', ownerPubky: OWNER }),
    );
    expect(await StorageService.getContact(PEER, OTHER)).toEqual(
      expect.objectContaining({ displayName: 'Foreign' }),
    );
    const msgs = await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`);
    expect(msgs.map(m => m.body)).toEqual(['hello from owner']);
    expect(await StorageService.getLinkReadCursor(OWNER, `dm:${PEER}`)).toBe(20);
    expect(await StorageService.getAttachment(OWNER, OWNER, EVENT)).toEqual(
      expect.objectContaining({
        keyRef: '',
        localCachePath: null,
        resolveState: 'unavailable-from-backup',
      }),
    );
    expect(mockedNative.attachmentDecrypt).toHaveBeenCalledWith(
      expect.stringMatching(/^ct:/),
      RECOVERY,
      'nonce-b64',
      backupLatestUrl(OWNER),
    );
  });

  it('restore is idempotent', async () => {
    await openHarness();
    await seedOwnerAndForeign();
    await BackupService.exportBackup();

    await BackupService.restoreBackup(RECOVERY);
    await BackupService.restoreBackup(`  ${RECOVERY}  `);

    expect((await StorageService.getAllContacts(OWNER)).map(c => c.pubky)).toEqual([PEER]);
    expect(await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`)).toHaveLength(
      1,
    );
  });

  it('rejects a foreign-owner snapshot and skips foreign rows on import', async () => {
    await openHarness();
    const foreign: OwnerBackupSnapshot = {
      version: OWNER_BACKUP_VERSION,
      ownerPubky: OTHER,
      exportedAt: 1,
      contacts: [],
      messageRequests: [],
      linkMessages: [],
      readCursors: [],
      groupChannels: [],
      groupMembers: [],
      groupMessages: [],
      paymentRequests: [],
      tipEndpoints: [],
      attachments: [],
    };
    mockedNative.attachmentDecrypt.mockResolvedValueOnce(
      Buffer.from(JSON.stringify(foreign)).toString('base64url').replace(/=+$/, ''),
    );
    uploaded.set(
      backupLatestUrl(OWNER),
      JSON.stringify({
        version: 1,
        algorithm: 'XChaCha20Poly1305',
        nonceB64: 'n',
        ciphertextB64: 'ct:x',
      }),
    );
    await expect(BackupService.restoreBackup(RECOVERY)).rejects.toThrow(
      'Backup belongs to a different account',
    );

    const mixed: OwnerBackupSnapshot = {
      version: OWNER_BACKUP_VERSION,
      ownerPubky: OWNER,
      exportedAt: 1,
      contacts: [
        {
          pubky: PEER,
          ownerPubky: OTHER,
          trustScore: 1,
          isFollowing: false,
          isFollower: false,
          isMutual: false,
          addedManually: false,
          firstSeenAt: 1,
        },
        {
          pubky: PEER,
          ownerPubky: OWNER,
          displayName: 'Kept',
          trustScore: 0.2,
          isFollowing: true,
          isFollower: false,
          isMutual: false,
          addedManually: true,
          firstSeenAt: 2,
        },
      ],
      messageRequests: [],
      linkMessages: [],
      readCursors: [],
      groupChannels: [],
      groupMembers: [],
      groupMessages: [],
      paymentRequests: [],
      tipEndpoints: [],
      attachments: [],
    };
    await StorageService.importOwnerBackup(OWNER, mixed);
    expect(await StorageService.getContact(PEER, OWNER)).toEqual(
      expect.objectContaining({ displayName: 'Kept' }),
    );
    expect(await StorageService.getContact(PEER, OTHER)).toBeNull();
  });
});
