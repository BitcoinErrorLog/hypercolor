/**
 * Adversarial persistence / identity / teardown coverage for M4 attachments.
 */
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in attachment security tests');
  },
}));

jest.mock('../../KeyStore', () => {
  const secrets = new Map<string, { key: string; nonce: string; algorithm: string }>();
  return {
    KeyStore: {
      _secrets: secrets,
      getPubky: jest.fn(),
      setAttachmentSecret: jest.fn(
        async (
          owner: string,
          sender: string,
          eventId: string,
          material: { key: string; nonce: string; algorithm: string },
        ) => {
          secrets.set(`${owner}:${sender}:${eventId}`, material);
        },
      ),
      getAttachmentSecret: jest.fn(async (owner: string, sender: string, eventId: string) => {
        return secrets.get(`${owner}:${sender}:${eventId}`) ?? null;
      }),
      deleteAttachmentSecrets: jest.fn(
        async (owner: string, refs: { senderPubky: string; eventId: string }[]) => {
          for (const ref of refs) {
            secrets.delete(`${owner}:${ref.senderPubky}:${ref.eventId}`);
          }
          return [];
        },
      ),
      clearAttachmentSecretsForOwner: jest.fn(async (owner: string) => {
        for (const key of [...secrets.keys()]) {
          if (key.startsWith(`${owner}:`)) secrets.delete(key);
        }
        return [];
      }),
      deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
      attachmentKeyService: (owner: string, sender: string, eventId: string) =>
        `hypercolor-attachment-key:${owner}:${sender}:${eventId}`,
      clear: jest.fn(),
    },
  };
});

jest.mock('../fileIo', () => ({
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
  cachePathsForAttachment: ({
    ownerPubky,
    senderPubky,
    eventId,
    localCachePath,
  }: {
    ownerPubky: string;
    senderPubky: string;
    eventId: string;
    localCachePath: string | null;
  }) => {
    const primary = `file:///cache/hypercolor-attachments/${ownerPubky}/${senderPubky}/${eventId}`;
    const paths = [primary, `${primary}.thumb`];
    if (localCachePath) {
      paths.push(localCachePath);
      if (!localCachePath.endsWith('.thumb')) paths.push(`${localCachePath}.thumb`);
    }
    return paths;
  },
}));

import { getDb, setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../StorageService';
import { clearPaintedOwner, paintOwner } from '../../paintedOwner';
import { KeyStore } from '../../KeyStore';
import { applyAttachmentInbound } from '../applyAttachmentInbound';
import { reconstructAttachmentWireJson } from '../redaction';
import { deleteCacheFiles } from '../fileIo';
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_PLACEHOLDER,
  attachmentKeyRef,
  buildAttachmentEnvelope,
  buildAttachmentLocation,
  CHAT_ATTACHMENT_KIND,
} from '../../../types/attachment';
const LINK_RETRY_PAYLOAD_TYPE = 'link.chat.message';

const secrets = (
  KeyStore as unknown as {
    _secrets: Map<string, { key: string; nonce: string; algorithm: string }>;
  }
)._secrets;

const OWNER = 'a'.repeat(52);
const PEER_A = 'b'.repeat(52);
const PEER_B = 'c'.repeat(52);
const OTHER_OWNER = 'd'.repeat(52);
const EVENT = '00000000-0000-4000-8000-000000000001';
const ATTACHMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LIVE_KEY = 'K'.repeat(43);
const LIVE_NONCE = 'N'.repeat(32);
const NOW = 1_700_000_000_000;

function accessJson(sender: string, eventId = EVENT): string {
  return buildAttachmentEnvelope({
    eventId,
    sentAt: NOW,
    location: buildAttachmentLocation(sender, ATTACHMENT_ID),
    key: LIVE_KEY,
    nonce: LIVE_NONCE,
    algorithm: ATTACHMENT_ALGORITHM,
    contentType: 'image/jpeg',
    size: 12,
  }).json;
}

function assertNoLiveSecrets(raw: string): void {
  expect(raw).not.toContain(LIVE_KEY);
  expect(raw).not.toContain(LIVE_NONCE);
}

describe('attachment security (sqlite)', () => {
  beforeEach(async () => {
    secrets.clear();
    jest.clearAllMocks();
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    jest.mocked(KeyStore.getPubky).mockReturnValue(OWNER);
    paintOwner(OWNER);
  });

  afterEach(() => {
    setDbForTests(null);
    clearPaintedOwner();
  });

  it('never persists live key/nonce in stream, messages, group, or retry queue', async () => {
    const rawJson = accessJson(PEER_A);
    expect(rawJson).toContain(LIVE_KEY);

    await StorageService.saveLinkStreamItems([
      {
        id: 'st-1',
        ownerPubky: OWNER,
        peerPubky: PEER_A,
        kind: CHAT_ATTACHMENT_KIND,
        rawJson,
        receivedAt: NOW,
      },
    ]);
    await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson,
      receivedAt: NOW,
    });
    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId: EVENT,
        conversationId: `dm:${PEER_A}`,
        peerPubky: PEER_A,
        senderPubky: OWNER,
        direction: 'sent',
        kind: CHAT_ATTACHMENT_KIND,
        rawJson,
        body: '[attachment]',
        sentAt: NOW,
        receivedAt: null,
        deliveryState: 'sending',
      },
      queueItem: {
        id: 'q-1',
        messageId: EVENT,
        recipientPubky: PEER_A,
        payload: JSON.stringify({
          type: LINK_RETRY_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER_A,
          senderPubky: OWNER,
          kind: CHAT_ATTACHMENT_KIND,
          eventId: EVENT,
          rawJson,
        }),
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    });

    const db = await getDb();
    const stream = db.executeSync('SELECT raw_json FROM link_stream_items').rows ?? [];
    const messages = db.executeSync('SELECT raw_json FROM link_messages').rows ?? [];
    const queue = db.executeSync('SELECT payload FROM delivery_queue').rows ?? [];
    for (const row of [...stream, ...messages]) {
      assertNoLiveSecrets(String(row.raw_json));
      expect(String(row.raw_json)).toContain(ATTACHMENT_KEY_PLACEHOLDER);
    }
    for (const row of queue) {
      assertNoLiveSecrets(String(row.payload));
      expect(String(row.payload)).toContain(ATTACHMENT_KEY_PLACEHOLDER);
    }
  });

  it('reconstructs the live wire JSON from the redacted copy + KeyStore', async () => {
    await KeyStore.setAttachmentSecret(OWNER, OWNER, EVENT, {
      key: LIVE_KEY,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    const live = accessJson(OWNER);
    const redacted = JSON.stringify({
      ...JSON.parse(live),
      key: ATTACHMENT_KEY_PLACEHOLDER,
      nonce: ATTACHMENT_KEY_PLACEHOLDER,
    });
    const rebuilt = await reconstructAttachmentWireJson(
      redacted,
      attachmentKeyRef(OWNER, OWNER, EVENT),
    );
    expect(JSON.parse(rebuilt)).toEqual(JSON.parse(live));
  });

  it('keeps the same event_id from two senders isolated', async () => {
    await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson: accessJson(PEER_A),
      receivedAt: NOW,
    });
    await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_B,
      peerPubky: PEER_B,
      rawJson: accessJson(PEER_B),
      receivedAt: NOW,
    });
    const a = await StorageService.getAttachment(OWNER, PEER_A, EVENT);
    const b = await StorageService.getAttachment(OWNER, PEER_B, EVENT);
    expect(a?.senderPubky).toBe(PEER_A);
    expect(b?.senderPubky).toBe(PEER_B);
    expect(a?.keyRef).toBe(attachmentKeyRef(OWNER, PEER_A, EVENT));
    expect(b?.keyRef).toBe(attachmentKeyRef(OWNER, PEER_B, EVENT));
    expect(secrets.get(`${OWNER}:${PEER_A}:${EVENT}`)?.key).toBe(LIVE_KEY);
    expect(secrets.has(`${OWNER}:${PEER_B}:${EVENT}`)).toBe(true);
    await KeyStore.setAttachmentSecret(OWNER, PEER_B, EVENT, {
      key: 'Z'.repeat(43),
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    expect(secrets.get(`${OWNER}:${PEER_A}:${EVENT}`)?.key).toBe(LIVE_KEY);
    expect(secrets.get(`${OWNER}:${PEER_B}:${EVENT}`)?.key).toBe('Z'.repeat(43));
  });

  it('isolates the same event_id across owners', async () => {
    await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson: accessJson(PEER_A),
      receivedAt: NOW,
    });
    paintOwner(OTHER_OWNER);
    await applyAttachmentInbound({
      ownerPubky: OTHER_OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson: accessJson(PEER_A),
      receivedAt: NOW,
    });
    paintOwner(OWNER);
    expect(await StorageService.getAttachment(OWNER, PEER_A, EVENT)).not.toBeNull();
    expect(await StorageService.getAttachment(OTHER_OWNER, PEER_A, EVENT)).not.toBeNull();
    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.getAttachment(OWNER, PEER_A, EVENT)).toBeNull();
    expect(await StorageService.getAttachment(OTHER_OWNER, PEER_A, EVENT)).not.toBeNull();
    expect(secrets.has(`${OTHER_OWNER}:${PEER_A}:${EVENT}`)).toBe(true);
  });

  it('teardown deletes attachment keys and both cache files before dropping rows', async () => {
    const cachePath = `file:///cache/hypercolor-attachments/${OWNER}/${PEER_A}/${EVENT}`;
    await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER_A,
      peerPubky: PEER_A,
      rawJson: accessJson(PEER_A),
      receivedAt: NOW,
    });
    await StorageService.updateAttachmentResolve(OWNER, PEER_A, EVENT, {
      resolveState: 'ready',
      localCachePath: cachePath,
    });
    const order: string[] = [];
    jest.mocked(KeyStore.deleteAttachmentSecrets).mockImplementation(async (owner, refs) => {
      order.push('keys');
      expect(
        await StorageService.getAttachment(owner, refs[0]!.senderPubky, refs[0]!.eventId),
      ).not.toBeNull();
      return [];
    });
    jest.mocked(deleteCacheFiles).mockImplementation(async paths => {
      order.push('cache');
      expect(paths).toEqual(expect.arrayContaining([cachePath, `${cachePath}.thumb`]));
      expect(await StorageService.getAttachment(OWNER, PEER_A, EVENT)).not.toBeNull();
    });

    await StorageService.clearAccountData(OWNER);
    order.push('rows');
    expect(order[0]).toBe('keys');
    expect(order[1]).toBe('cache');
    expect(order[order.length - 1]).toBe('rows');
    expect(await StorageService.getAttachment(OWNER, PEER_A, EVENT)).toBeNull();
  });
});
