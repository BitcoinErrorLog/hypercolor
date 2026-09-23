jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the SQL integration test');
  },
}));

jest.mock('../../Telemetry', () => ({
  Telemetry: { record: jest.fn() },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    isInitialized: jest.fn(() => true),
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    getLinkSession: jest.fn(() => null),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    deleteLinkSessionIfAlias: jest.fn(() => true),
    readLinkSession: jest.fn(() => ({ ok: true, alias: null })),
    markSignOutIncomplete: jest.fn(),
    isSignOutIncomplete: jest.fn(() => false),
    getSignOutIncompleteOwner: jest.fn(() => null),
    clearSignOutIncomplete: jest.fn(),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../homeserverOrigin', () => ({
  resolveHomeserverOrigin: async () => 'https://homeserver.example',
  parsePubkyOwner: () => null,
}));

jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    generateReceiverKey: jest.fn(),
    getReceiverPublicKey: jest.fn(),
    startAuthFlow: jest.fn(),
    awaitAuthApproval: jest.fn(),
    stopAuthKeepalive: jest.fn(),
    cancelAuthFlow: jest.fn(),
    signinWithSecret: jest.fn(),
    adoptAuthSession: jest.fn(),
    restoreSession: jest.fn(),
    signOutSession: jest.fn(),
    clearAllNativeSecrets: jest.fn(),
    publishReceiverMarker: jest.fn(),
    getReceiverMarker: jest.fn(),
    removeReceiverMarker: jest.fn(),
    initiateLink: jest.fn(),
    probeInboundLink: jest.fn(),
    advanceHandshake: jest.fn(),
    restoreHandshake: jest.fn(),
    restoreLink: jest.fn(),
    sendPrivateMessageJson: jest.fn(),
    receivePrivateMessages: jest.fn(),
    clearLinkOutbox: jest.fn(),
    closeLink: jest.fn(),
    putPublic: jest.fn(),
    deletePublic: jest.fn(),
  },
  isLinkNativeError: (err: unknown) =>
    typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string',
  createLinkNativeError: (code: string, message: string) => ({ code, message }),
  toLinkNativeError: (err: unknown) => err,
}));

import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import liveShape from './fixtures/live-homeserver-shape.json';
import { LINK_RECEIVER_PATH, type LinkRecord } from '../../../types/link';
import { KeyStore } from '../../KeyStore';
import { StorageService } from '../../StorageService';
import { FollowsImportSettings } from '../../contacts/followsImportSettings';
import {
  buildPreparedSendIntent,
  LinkService,
  resetLinkServiceHarnessState,
  stopLinkRetryDrain,
} from '../LinkService';
import { PaykitLinkNative } from '../PaykitLinkNative';
import { PaykitSdkNative } from '../PaykitSdkNative';
import { seedPaykitSdkJestMock } from './paykitSdkJestMock';

const C = 'a'.repeat(52);
const D = 'z'.repeat(52);
const C_ALIAS = 'session-c';
const D_ALIAS = 'session-d';
const C_NOISE = 'noise-c';
const D_NOISE = 'noise-d';
const PATH = LINK_RECEIVER_PATH;

type Slot = { owner: string; peer: string; slot: string; bytes: string };

class SharedHomeserver {
  readonly slots = new Map<string, Slot>();
  readonly clears: Array<{ owner: string; peer: string }> = [];
  private generation = 0;

  seedFixture(): void {
    // The fixture is the captured redacted shape, not a reconstructed payload.
    expect(liveShape.directory.status).toBe(404);
    expect(liveShape.peer.slots).toEqual({ 0: 404, 1: 200, 3: 404 });
    this.slots.set(`${C}:messages:1`, { owner: C, peer: D, slot: '1', bytes: 'captured-slot-1' });
  }

  put(owner: string, peer: string, slot: string, bytes: string): void {
    this.slots.set(`${owner}:messages:${slot}`, { owner, peer, slot, bytes });
  }

  snapshot(): string {
    return JSON.stringify([...this.slots.entries()]);
  }

  clear(owner: string, peer: string): number {
    this.clears.push({ owner, peer });
    let count = 0;
    for (const [key, value] of this.slots) {
      if (value.owner === owner && value.peer === peer) {
        this.slots.delete(key);
        count += 1;
      }
    }
    return count;
  }

  nextSnapshot(prefix: string): string {
    this.generation += 1;
    return `${prefix}-${this.generation}`;
  }
}

const native = jest.mocked(PaykitLinkNative) as unknown as jest.Mocked<typeof PaykitLinkNative> &
  Record<
    | 'initiateLink'
    | 'probeInboundLink'
    | 'advanceHandshake'
    | 'restoreHandshake'
    | 'restoreLink'
    | 'clearLinkOutbox',
    jest.Mock
  >;
const keyStore = jest.mocked(KeyStore);

function record(owner: string, peer: string, status: LinkRecord['status']): LinkRecord {
  return {
    ownerPubky: owner,
    peerPubky: peer,
    role: 'initiator',
    status,
    snapshot: `snapshot-${owner}`,
    remoteNoisePublicKey: peer === C ? C_NOISE : D_NOISE,
    localReceiverPath: PATH,
    remoteReceiverPath: PATH,
    consecutiveFailures: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('real SQLite non-destructive link recovery', () => {
  let db: ReturnType<typeof openMemoryDb> | null = null;
  let owner = C;
  let peer = D;
  let homeserver: SharedHomeserver;
  let restoreFailure = false;
  let receiveFailure: unknown = null;

  beforeEach(async () => {
    seedPaykitSdkJestMock();
    owner = C;
    peer = D;
    restoreFailure = false;
    receiveFailure = null;
    homeserver = new SharedHomeserver();
    homeserver.seedFixture();
    db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    FollowsImportSettings.resetForTests();
    resetLinkServiceHarnessState();
    native.isAvailable.mockReturnValue(true);
    native.signinWithSecret.mockImplementation(async () => ({
      sessionAlias: owner === C ? C_ALIAS : D_ALIAS,
      pubky: owner,
    }));
    native.closeLink.mockResolvedValue(undefined);
    native.clearLinkOutbox.mockImplementation(async () => homeserver.clear(owner, peer));
    native.getReceiverPublicKey.mockImplementation(async () => (owner === C ? C_NOISE : D_NOISE));
    native.getReceiverMarker.mockImplementation(async (target: string) => ({
      noisePublicKey: target === C ? C_NOISE : D_NOISE,
    }));
    native.publishReceiverMarker.mockResolvedValue(undefined);
    native.initiateLink.mockImplementation(async () => {
      const snapshot = homeserver.nextSnapshot(`hs-${owner}`);
      homeserver.put(owner, peer, '0', `msg1-${snapshot}`);
      return { linkId: `init-${snapshot}`, snapshot };
    });
    native.restoreLink.mockImplementation(async () => {
      if (restoreFailure || !homeserver.slots.has(`${owner}:messages:1`)) {
        throw { code: 'network', message: 'transport_error' };
      }
      return { linkId: `restored-${owner}` };
    });
    native.restoreHandshake.mockImplementation(async (_a, _r, target, _pk, _lp, _rp, snapshot) => {
      const hasMsg2 = [...homeserver.slots.values()].some(
        slot => slot.owner === target && slot.peer === owner && slot.slot === '1',
      );
      if (
        !hasMsg2 &&
        !String(snapshot).startsWith('competing-msg1') &&
        !String(snapshot).startsWith('msg1-') &&
        !String(snapshot).startsWith('round-one-msg1')
      ) {
        throw { code: 'protocol', message: 'no msg2 for this generation' };
      }
      return { linkId: 'restored-hs', status: 'pending' };
    });
    native.advanceHandshake.mockImplementation(async () => ({
      status: 'established',
      snapshot: homeserver.nextSnapshot(`est-${owner}`),
    }));
    native.probeInboundLink.mockImplementation(async () => {
      const inbound = [...homeserver.slots.values()].find(
        slot => slot.owner === peer && slot.peer === owner && slot.slot === '0',
      );
      return inbound
        ? { result: 'pending', linkId: `probe-${inbound.bytes}`, snapshot: inbound.bytes }
        : { result: 'none' };
    });
    native.sendPrivateMessageJson.mockResolvedValue({ snapshot: 'sent' });
    native.receivePrivateMessages.mockImplementation(async () => {
      if (receiveFailure) throw receiveFailure;
      return { messages: [], snapshot: 'received' };
    });
    native.signOutSession.mockResolvedValue(undefined);
    keyStore.getPubky.mockImplementation(() => owner);
    keyStore.getLinkSession.mockImplementation(() => (owner === C ? C_ALIAS : D_ALIAS));
    await LinkService.signinWithSecret('test-secret');
    await StorageService.upsertLinkReceiver({
      ownerPubky: owner,
      receiverAlias: `${owner}-receiver`,
      receiverPath: PATH,
      markerPublished: true,
    });
  });

  afterEach(() => {
    stopLinkRetryDrain();
    resetLinkServiceHarnessState();
    FollowsImportSettings.resetForTests();
    db?.close();
    db = null;
    setDbForTests(null);
    jest.restoreAllMocks();
  });

  it('marks captured-shape restore failure without deleting slots', async () => {
    await StorageService.upsertLink(record(C, D, 'established'));
    const oldSlot = homeserver.slots.get(`${C}:messages:1`)?.bytes;
    jest.mocked(PaykitSdkNative.observeEncryptedLinkRecoveryMarker).mockResolvedValue({
      state: 'RECOVERY_REQUIRED',
      remoteMarkerChanged: false,
      localAttemptId: null,
      remoteAttemptId: null,
    });
    await expect(LinkService.syncInbox([D])).resolves.toEqual([]);
    expect((await StorageService.getLink(C, D))?.status).toBe('reconnect_required');
    expect(homeserver.clears).toHaveLength(0);

    expect(homeserver.slots.get(`${C}:messages:1`)?.bytes).toBe(oldSlot);
    expect(homeserver.clears).toHaveLength(0);
  });

  it('keeps reconnect_required sticky during background and queued recovery', async () => {
    await StorageService.upsertLink(record(C, D, 'established'));
    jest.mocked(PaykitSdkNative.observeEncryptedLinkRecoveryMarker).mockResolvedValue({
      state: 'RECOVERY_REQUIRED',
      remoteMarkerChanged: false,
      localAttemptId: null,
      remoteAttemptId: null,
    });
    await expect(LinkService.syncInbox([D])).resolves.toEqual([]);
    expect((await StorageService.getLink(C, D))?.status).toBe('reconnect_required');

    const prepared = buildPreparedSendIntent({
      ownerPubky: C,
      peerPubky: C,
      kind: 'chat.message.v0',
      eventId: '00000000-0000-4000-8000-000000000001',
      rawJson: JSON.stringify({
        kind: 'chat.message.v0',
        event_id: '00000000-0000-4000-8000-000000000001',
        sent_at: Date.now(),
        body: 'queued',
      }),
      body: 'queued',
      sentAt: Date.now(),
      queueId: 'queued-reconnect-required',
    });
    prepared.queueItem.payload = JSON.stringify({
      ...JSON.parse(prepared.queueItem.payload),
      peerPubky: D,
      recipientPubky: D,
    });
    prepared.message.peerPubky = D;
    await StorageService.persistLinkSendIntent(prepared);
    await LinkService.drainRetries();

    expect((await StorageService.getLink(C, D))?.status).toBe('reconnect_required');
    expect(native.initiateLink).not.toHaveBeenCalled();
    expect(native.probeInboundLink).not.toHaveBeenCalled();
    expect(homeserver.slots.get(`${C}:messages:1`)?.bytes).toBe('captured-slot-1');
    expect(homeserver.clears).toHaveLength(0);
  });

  it('keeps an established link unchanged when receive parsing fails', async () => {
    await StorageService.upsertLink(record(C, D, 'established'));
    receiveFailure = new Error('tag parser failure');
    await expect(LinkService.syncInbox([D])).resolves.toEqual([]);
    expect((await StorageService.getLink(C, D))?.status).toBe('established');
    expect(homeserver.clears).toHaveLength(0);
  });

  it('isolates a plain application routing failure and delivers the next item', async () => {
    await StorageService.upsertLink(record(C, D, 'established'));
    const firstId = '00000000-0000-4000-8000-000000000002';
    const secondId = '00000000-0000-4000-8000-000000000003';
    native.receivePrivateMessages.mockResolvedValueOnce({
      messages: [
        {
          version: 1,
          kind: 'chat.message.v0',
          rawJson: JSON.stringify({
            kind: 'chat.message.v0',
            version: 1,
            event_id: firstId,
            sent_at: Date.now(),
            body: 'first',
          }),
        },
        {
          version: 1,
          kind: 'chat.message.v0',
          rawJson: JSON.stringify({
            kind: 'chat.message.v0',
            version: 1,
            event_id: secondId,
            sent_at: Date.now(),
            body: 'second',
          }),
        },
      ],
      snapshot: 'received-two',
    });
    const saveLinkMessage = jest
      .spyOn(StorageService, 'saveLinkMessage')
      .mockRejectedValueOnce(new Error('plaintext parser failure'));

    await expect(LinkService.syncInbox([D])).resolves.toHaveLength(1);

    const stream = db?.executeSync(
      `SELECT id, processed, processing_error_category, raw_json
       FROM link_stream_items
       WHERE owner_pubky = ? AND peer_pubky = ?
       ORDER BY received_at ASC`,
      [C, D],
    ).rows;
    expect(stream).toHaveLength(2);
    expect(stream?.[0]?.processed).toBe(1);
    expect(stream?.[0]?.processing_error_category).toBe('application');
    expect(stream?.[0]?.raw_json).not.toContain('plaintext parser failure');
    expect(stream?.[1]?.processed).toBe(1);
    expect(await StorageService.getLinkMessage(C, D, 'chat.message.v0', secondId)).toEqual(
      expect.objectContaining({ body: 'second' }),
    );
    expect((await StorageService.getLink(C, D))?.status).toBe('established');
    expect(homeserver.clears).toHaveLength(0);
    saveLinkMessage.mockRestore();
  });

  it('links from reconnect_required without rotating receiver noise or deleting remote slots', async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    await StorageService.upsertLink(record(C, D, 'reconnect_required'));
    native.initiateLink.mockClear();
    native.probeInboundLink.mockClear();
    native.clearLinkOutbox.mockClear();
    native.deletePublic.mockClear();
    native.removeReceiverMarker.mockClear();

    try {
      await expect(LinkService.ensureLinkWith(D)).resolves.toBe('ready');

      const latest = await StorageService.getLink(C, D);
      expect(latest?.status).toBe('established');
      expect(latest?.snapshot).toBe('sdk:1');
      expect(latest?.remoteNoisePublicKey).toBe(D_NOISE);
      expect(native.initiateLink).not.toHaveBeenCalled();
      expect(native.clearLinkOutbox).not.toHaveBeenCalled();
      expect(native.deletePublic).not.toHaveBeenCalled();
      expect(native.removeReceiverMarker).not.toHaveBeenCalled();
      expect(homeserver.clears).toHaveLength(0);
      expect(homeserver.slots.get(`${C}:messages:1`)?.bytes).toBe('captured-slot-1');
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('keeps reconnect_required when the SDK reports recovery and does not delete remote slots', async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    await StorageService.upsertLink(record(C, D, 'reconnect_required'));
    jest.mocked(PaykitSdkNative.observeEncryptedLinkRecoveryMarker).mockResolvedValue({
      state: 'RECOVERY_REQUIRED',
      remoteMarkerChanged: false,
      localAttemptId: null,
      remoteAttemptId: null,
    });
    native.initiateLink.mockClear();
    native.clearLinkOutbox.mockClear();

    try {
      await expect(LinkService.ensureLinkWith(D)).resolves.toBe('reconnect_required');

      expect((await StorageService.getLink(C, D))?.status).toBe('reconnect_required');
      expect(PaykitSdkNative.ensureLinkWithPeer).not.toHaveBeenCalled();
      expect(native.initiateLink).not.toHaveBeenCalled();
      expect(native.clearLinkOutbox).not.toHaveBeenCalled();
      expect(homeserver.clears).toHaveLength(0);
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('establishes when the peer marker fetch fails and the SDK reports LINKED', async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    await StorageService.upsertLink(record(C, D, 'reconnect_required'));
    native.getReceiverMarker.mockRejectedValue({
      code: 'network',
      message: 'homeserver unreachable',
    });
    native.initiateLink.mockClear();
    native.probeInboundLink.mockClear();
    native.clearLinkOutbox.mockClear();

    try {
      await expect(LinkService.ensureLinkWith(D)).resolves.toBe('ready');

      const latest = await StorageService.getLink(C, D);
      expect(latest?.status).toBe('established');
      expect(latest?.snapshot).toBe('sdk:1');
      expect(native.getReceiverMarker).toHaveBeenCalledWith(D, PATH);
      expect(native.initiateLink).not.toHaveBeenCalled();
      expect(native.probeInboundLink).not.toHaveBeenCalled();
      expect(native.clearLinkOutbox).not.toHaveBeenCalled();
      expect(homeserver.clears).toHaveLength(0);
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('does not restart reconnect_required links during receiver takeover', async () => {
    await StorageService.upsertLink(record(C, D, 'reconnect_required'));
    await LinkService.takeoverReceiver();

    expect((await StorageService.getLink(C, D))?.status).toBe('reconnect_required');
    expect(native.initiateLink).not.toHaveBeenCalled();
    expect(homeserver.slots.get(`${C}:messages:1`)?.bytes).toBe('captured-slot-1');
    expect(homeserver.clears).toHaveLength(0);
  });

  it('keeps declined and probe-error paths non-destructive', async () => {
    await StorageService.upsertLink(record(C, D, 'established'));
    await StorageService.upsertMessageRequest({
      ownerPubky: C,
      peerPubky: D,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'declined',
    });
    await expect(LinkService.syncInbox([D])).resolves.toEqual([]);
    expect((await StorageService.getLink(C, D))?.status).toBe('established');

    await StorageService.deleteMessageRequest(C, D);
    native.probeInboundLink.mockRejectedValue({ code: 'protocol', message: 'bad msg1' });
    await expect(LinkService.syncInbox([D])).resolves.toEqual([]);
    expect((await StorageService.getLink(C, D))?.status).toBe('established');
    expect(homeserver.clears).toHaveLength(0);
  });

  it('aborts owner changes before local or remote mutation', async () => {
    await StorageService.upsertLink(record(C, D, 'established'));
    const before = homeserver.snapshot();
    const pending = new Promise<{ noisePublicKey: string }>(() => undefined);
    native.getReceiverMarker.mockImplementationOnce(async () => {
      owner = D;
      throw { code: 'network', message: 'owner changed' };
    });
    await expect(LinkService.syncInbox([D])).resolves.toEqual([]);
    expect(homeserver.snapshot()).toBe(before);
    expect(homeserver.clears).toHaveLength(0);
    void pending;
  });
});
