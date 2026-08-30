import { setDbForTests } from '../../../db';
import { runMigrations } from '../../../db/migrations';
import { openMemoryDb } from '../../../db/__tests__/betterSqliteAdapter';
import { ATTACHMENT_MAX_BYTES } from '../../../flags/config';
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH } from '../../../types/link';
import { StorageService } from '../../StorageService';
import { classifyInboundPeer, wotInputFromContact } from '../wotGate';
import {
  runAttachmentLiveProof,
  runBackupLiveProof,
  runContactsLiveProof,
  runGroupLiveProof,
  runLinkServiceLiveProof,
  runNamedLiveProofs,
  runPaymentHandoffLiveProof,
} from '../liveProofRun';
import type { LiveProofLinkApi, ProductLiveProofDeps } from '../liveProofShared';
import type { PaykitLinkNativeApi } from '../PaykitLinkNative';

jest.mock('uuid', () => ({
  v4: jest.fn(() => '00000000-0000-4000-8000-000000000099'),
}));

jest.mock('../LinkService', () => ({
  LinkService: {
    enable: jest.fn(),
    getEnableStatus: jest.fn(),
    signinWithSecret: jest.fn(),
    clearSession: jest.fn(),
    adoptHarnessSession: jest.fn(),
    provisionHarnessReceiver: jest.fn(),
    ensureLinkWith: jest.fn(),
    sendDm: jest.fn(),
    syncInbox: jest.fn(),
    sendPreparedMessage: jest.fn(),
  },
  resetLinkServiceHarnessState: jest.fn(),
}));

jest.mock('../../RetryQueue', () => ({
  RetryQueue: {
    enqueue: jest.fn(),
    getDue: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
    defer: jest.fn(),
  },
}));

jest.mock('../../Telemetry', () => ({
  Telemetry: { increment: jest.fn(), getCounters: jest.fn(() => ({})) },
}));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the live-proof harness unit test');
  },
}));

jest.mock('../../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(),
    setPubky: jest.fn(),
    setLinkSession: jest.fn(),
    deleteLinkSession: jest.fn(),
    getAttachmentSecret: jest.fn(),
    setAttachmentSecret: jest.fn(),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('../../PubkyService', () => ({
  PubkyService: {
    put: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    getHomeserver: jest.fn(),
    getProfile: jest.fn(),
  },
}));

jest.mock('../../attachments/fileIo', () => ({
  deleteCacheFiles: jest.fn().mockResolvedValue(undefined),
  cachePathsForAttachment: () => [],
  writeFileFromStandardBase64: jest.fn().mockResolvedValue(undefined),
  readFileAsStandardBase64: jest.fn().mockResolvedValue({ base64: 'bGl2ZXByb29m', size: 10 }),
  attachmentCacheDirectory: () => 'file:///cache/',
}));

jest.mock('../PaykitLinkNative', () => ({
  PaykitLinkNative: {
    isAvailable: jest.fn(),
    signupWithSecret: jest.fn(),
    generateReceiverKey: jest.fn(),
    publishReceiverMarker: jest.fn(),
    getReceiverMarker: jest.fn(),
    removeReceiverMarker: jest.fn(),
    signOutSession: jest.fn(),
    closeLink: jest.fn(),
    clearAllNativeSecrets: jest.fn(),
    attachmentDecrypt: jest.fn(),
  },
  isLinkNativeError: (err: unknown) => {
    if (typeof err !== 'object' || err === null) return false;
    return typeof (err as { code?: unknown }).code === 'string';
  },
}));

import { KeyStore } from '../../KeyStore';
import { PaykitLinkNative } from '../PaykitLinkNative';

const mockedNative = jest.mocked(PaykitLinkNative);
const mockedKeyStore = jest.mocked(KeyStore);

const HS = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
const PUBKY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PUBKY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PUBKY_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccc';
const TWO = { homeserverPubky: HS, signupTokenA: 'token-a', signupTokenB: 'token-b' };
const THREE = { ...TWO, signupTokenC: 'token-c' };

function secrets(): Uint8Array[] {
  return [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(32).fill(3)];
}

function clockDeps(): Pick<
  ProductLiveProofDeps,
  'now' | 'sleep' | 'randomBytes' | 'handshakeTimeoutMs' | 'receiveTimeoutMs' | 'pollIntervalMs'
> {
  const queue = secrets();
  let now = 1_700_000_000_000;
  return {
    now: () => {
      now += 1;
      return now;
    },
    sleep: async () => undefined,
    randomBytes: () => queue.shift() ?? new Uint8Array(32).fill(9),
    handshakeTimeoutMs: 5,
    receiveTimeoutMs: 5,
    pollIntervalMs: 0,
  };
}

function mockSignup(): void {
  mockedNative.isAvailable.mockReturnValue(true);
  mockedNative.signupWithSecret.mockImplementation(async (_secret, _hs, token) => {
    if (token === 'token-a') return { sessionAlias: 'session-a', pubky: PUBKY_A };
    if (token === 'token-c') return { sessionAlias: 'session-c', pubky: PUBKY_C };
    return { sessionAlias: 'session-b', pubky: PUBKY_B };
  });
  mockedNative.removeReceiverMarker.mockResolvedValue(undefined);
  mockedNative.signOutSession.mockResolvedValue(undefined);
  mockedNative.closeLink.mockResolvedValue(undefined);
  mockedNative.clearAllNativeSecrets.mockResolvedValue(undefined);
  mockedNative.attachmentDecrypt.mockRejectedValue(new Error('aad mismatch'));
}

type Queued = { eventId: string; body: string; sender: string };

function createProductLink(): LiveProofLinkApi {
  let owner = '';
  const inbox = new Map<string, Queued[]>();
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  };
  const key = (to: string, from: string): string => `${to}<-${from}`;

  return {
    adoptHarnessSession: async (_alias, pubky) => {
      owner = pubky;
      mockedKeyStore.getPubky.mockReturnValue(pubky);
    },
    provisionHarnessReceiver: async () => ({
      pubky: owner,
      receiverPath: LINK_RECEIVER_PATH,
      noisePublicKey: `noise-${owner.slice(0, 1)}`,
    }),
    ensureLinkWith: async peer => {
      await StorageService.upsertLink({
        ownerPubky: owner,
        peerPubky: peer,
        role: 'initiator',
        status: 'established',
        snapshot: 'snap',
        remoteNoisePublicKey: 'noise',
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
      });
      return 'ready';
    },
    sendDm: async (peer, body) => {
      const eventId = nextId();
      await StorageService.saveLinkMessage({
        ownerPubky: owner,
        eventId,
        conversationId: `dm:${peer}`,
        peerPubky: peer,
        senderPubky: owner,
        direction: 'sent',
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{}',
        body,
        sentAt: Date.now(),
        receivedAt: null,
        deliveryState: 'sent',
      });
      const queued = inbox.get(key(peer, owner)) ?? [];
      queued.push({ eventId, body, sender: owner });
      inbox.set(key(peer, owner), queued);
      return { eventId, body, deliveryState: 'sent' };
    },
    syncInbox: async (peers = []) => {
      const delivered: Array<{ eventId: string; body: string }> = [];
      for (const peer of peers) {
        const queued = inbox.get(key(owner, peer)) ?? [];
        const priorLink = await StorageService.getLink(owner, peer);
        const contact = await StorageService.getContact(peer, owner);
        const priorMessages = await StorageService.countLinkMessagesForPeer(owner, peer);
        const existing = await StorageService.getMessageRequest(owner, peer);
        const isNewInbound = priorLink === null && priorMessages === 0;
        if (existing?.status === 'declined') continue;
        if (isNewInbound && existing?.status !== 'accepted') {
          const decision = classifyInboundPeer(wotInputFromContact(contact, priorMessages > 0));
          if (decision === 'request') {
            const ts = Date.now();
            await StorageService.upsertMessageRequest({
              ownerPubky: owner,
              peerPubky: peer,
              createdAt: existing?.createdAt ?? ts,
              updatedAt: ts,
              status: 'pending',
            });
            await StorageService.upsertLink({
              ownerPubky: owner,
              peerPubky: peer,
              role: 'responder',
              status: 'established',
              snapshot: 'snap',
              remoteNoisePublicKey: 'noise',
              localReceiverPath: LINK_RECEIVER_PATH,
              remoteReceiverPath: LINK_RECEIVER_PATH,
              consecutiveFailures: 0,
            });
            continue;
          }
        }
        if (existing?.status === 'pending' && !isNewInbound) {
          continue;
        }
        await StorageService.upsertLink({
          ownerPubky: owner,
          peerPubky: peer,
          role: 'responder',
          status: 'established',
          snapshot: 'snap',
          remoteNoisePublicKey: 'noise',
          localReceiverPath: LINK_RECEIVER_PATH,
          remoteReceiverPath: LINK_RECEIVER_PATH,
          consecutiveFailures: 0,
        });
        inbox.set(key(owner, peer), []);
        for (const item of queued) {
          const already = await StorageService.hasLinkMessage(
            owner,
            item.sender,
            CHAT_MESSAGE_KIND,
            item.eventId,
          );
          if (already) continue;
          await StorageService.saveLinkMessage({
            ownerPubky: owner,
            eventId: item.eventId,
            conversationId: `dm:${peer}`,
            peerPubky: peer,
            senderPubky: item.sender,
            direction: 'received',
            kind: CHAT_MESSAGE_KIND,
            rawJson: '{}',
            body: item.body,
            sentAt: Date.now(),
            receivedAt: Date.now(),
            deliveryState: 'delivered',
          });
          delivered.push({ eventId: item.eventId, body: item.body });
        }
      }
      return delivered;
    },
    sendPreparedMessage: async input => {
      return { eventId: input.eventId, body: input.body, deliveryState: 'sent' };
    },
  };
}

describe('product live-proof step machines', () => {
  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    mockSignup();
  });

  afterEach(() => {
    setDbForTests(null);
    jest.restoreAllMocks();
  });

  it('P0 walks LinkService sendDm/syncInbox and dedups a replayed poll', async () => {
    const link = createProductLink();
    const sendDm = jest.spyOn(link, 'sendDm');
    const report = await runLinkServiceLiveProof(TWO, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      link,
      ...clockDeps(),
    });
    expect(report.ok).toBe(true);
    expect(report.steps.map(step => step.step)).toEqual(
      expect.arrayContaining([
        'add-contact-ab-paste',
        'send-dm-a',
        'sync-inbox-b',
        'persist-inbound-b',
        'send-dm-b',
        'sync-inbox-a',
        'replay-inbox-dedup',
        'cleanup-sql',
      ]),
    );
    expect(sendDm).toHaveBeenCalled();
    expect(mockedNative.signupWithSecret).toHaveBeenCalled();
    const logged = jest.mocked(console.log).mock.calls.map(args => args.join(' '));
    expect(logged.some(line => line.includes('token-a'))).toBe(false);
    expect(logged.some(line => line.includes('01'.repeat(32)))).toBe(false);
  });

  it('P1 pastes B, auto-accepts B, holds C, and keeps a follower bit closed', async () => {
    const link = createProductLink();
    const contacts = {
      addManualContact: jest.fn(async (owner: string, raw: string) => {
        await StorageService.upsertContact({
          pubky: raw,
          ownerPubky: owner,
          trustScore: 0,
          isFollowing: false,
          isFollower: false,
          isMutual: false,
          addedManually: true,
          firstSeenAt: Date.now(),
        });
        return {
          ok: true as const,
          contact: {
            pubky: raw,
            ownerPubky: owner,
            trustScore: 0,
            isFollowing: false,
            isFollower: false,
            isMutual: false,
            addedManually: true,
            firstSeenAt: Date.now(),
          },
        };
      }),
      syncRelationships: jest.fn(async () => ({
        following: 0,
        followers: 0,
        friends: 0,
        nexusReachable: false,
        nexusError: 'ECONNREFUSED',
      })),
      importFollows: jest.fn(async () => ({
        ok: false as const,
        imported: 0 as const,
        followees: [] as [],
        message: 'homeserver list failed',
      })),
    };
    const report = await runContactsLiveProof(THREE, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      link,
      contacts,
      ...clockDeps(),
    });
    expect(report.ok).toBe(true);
    expect(report.steps.find(step => step.step === 'nexus-import')?.detail).toContain('skipped nexus');
    expect(report.steps.map(step => step.step)).toEqual(
      expect.arrayContaining([
        'add-contact-b-paste',
        'inbound-b-auto-accept',
        'inbound-c-request',
        'unilateral-follower-closed',
      ]),
    );
    expect(contacts.addManualContact).toHaveBeenCalledWith(PUBKY_A, PUBKY_B);
  });

  it('P2 creates a group, persists a message, rejects a removed sender and forgeries', async () => {
    const link = createProductLink();
    let channelId = '';
    const groups = {
      createChannel: jest.fn(async (name: string, members: string[]) => {
        channelId = `${PUBKY_A}:00000000-0000-4000-8000-00000000aaaa`;
        for (const owner of [PUBKY_A, PUBKY_B, PUBKY_C]) {
          await StorageService.upsertGroupChannel({
            ownerPubky: owner,
            channelId,
            name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdBy: PUBKY_A,
            isPublic: false,
            lastMessageAt: Date.now(),
            membershipEpoch: 0,
          });
          for (const member of [PUBKY_A, ...members]) {
            await StorageService.upsertGroupMember({
              ownerPubky: owner,
              channelId,
              memberPubky: member,
              role: member === PUBKY_A ? 'admin' : 'member',
              addedAt: Date.now(),
              removedAt: null,
              status: 'active',
            });
          }
        }
        return {
          ownerPubky: PUBKY_A,
          channelId,
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: PUBKY_A,
          isPublic: false,
          lastMessageAt: Date.now(),
          membershipEpoch: 0,
        };
      }),
      sendGroupMessage: jest.fn(async (id: string, body: string) => {
        const eventId =
          body === 'liveproof-group-body'
            ? '00000000-0000-4000-8000-00000000bbbb'
            : '00000000-0000-4000-8000-00000000cccc';
        if (body === 'liveproof-group-body') {
          for (const owner of [PUBKY_A, PUBKY_B, PUBKY_C]) {
            await StorageService.upsertGroupChannel({
              ownerPubky: owner,
              channelId: id,
              name: 'liveproof-group',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              createdBy: PUBKY_A,
              isPublic: false,
              lastMessageAt: Date.now(),
              membershipEpoch: 0,
            });
            await StorageService.saveGroupMessage({
              ownerPubky: owner,
              channelId: id,
              eventId,
              senderPubky: PUBKY_A,
              kind: 'chat.group.message.v0',
              body,
              rawJson: '{}',
              sentAt: Date.now(),
              receivedAt: owner === PUBKY_A ? null : Date.now(),
              deliveryState: 'sent' as const,
              replyToEventId: null,
              replyToAuthorPubky: null,
              targetEventId: null,
              targetAuthorPubky: null,
              editedAt: null,
              deleted: false,
            });
          }
        }
        return {
          ownerPubky: PUBKY_A,
          channelId: id,
          eventId,
          senderPubky: body === 'liveproof-after-remove' ? PUBKY_C : PUBKY_A,
          kind: 'chat.group.message.v0',
          body,
          rawJson: '{}',
          sentAt: Date.now(),
          receivedAt: null,
          deliveryState: 'sent' as const,
          replyToEventId: null,
          replyToAuthorPubky: null,
          targetEventId: null,
          targetAuthorPubky: null,
          editedAt: null,
          deleted: false,
        };
      }),
      removeMember: jest.fn(async (id: string, member: string) => {
        for (const owner of [PUBKY_A, PUBKY_B]) {
          await StorageService.upsertGroupMember({
            ownerPubky: owner,
            channelId: id,
            memberPubky: member,
            role: 'member',
            addedAt: Date.now(),
            removedAt: Date.now(),
            status: 'removed',
          });
        }
      }),
    };
    const report = await runGroupLiveProof(THREE, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      link,
      groups,
      ...clockDeps(),
    });
    expect(report.ok).toBe(true);
    expect(report.steps.map(step => step.step)).toEqual(
      expect.arrayContaining([
        'create-channel-a',
        'membership-fanout',
        'group-message-a',
        'remove-c',
        'removed-c-message-rejected',
        'forged-channel-and-event-rejected',
      ]),
    );
    expect(channelId.startsWith(`${PUBKY_A}:`)).toBe(true);
  });

  it('P3 sends a fixture, matches plaintext, and rejects over-limit', async () => {
    const link = createProductLink();
    const attachments = {
      sendAttachment: jest.fn(async () => {
        const eventId = '00000000-0000-4000-8000-00000000a001';
        const location = `pubky://${PUBKY_A}/pub/hypercolor.app/v1/attachments/${eventId}`;
        await StorageService.saveAttachment({
          ownerPubky: PUBKY_B,
          eventId,
          conversationId: `dm:${PUBKY_A}`,
          channelId: null,
          senderPubky: PUBKY_A,
          direction: 'received',
          location,
          keyRef: '',
          contentType: 'text/plain',
          size: 10,
          thumbnailLocation: null,
          localCachePath: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deliveryState: 'delivered',
          resolveState: 'pending',
        });
        return {
          ownerPubky: PUBKY_A,
          eventId,
          conversationId: `dm:${PUBKY_B}`,
          channelId: null,
          senderPubky: PUBKY_A,
          direction: 'sent' as const,
          location,
          keyRef: 'ref',
          contentType: 'text/plain',
          size: 10,
          thumbnailLocation: null,
          localCachePath: 'file:///cache/a',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deliveryState: 'sent' as const,
          resolveState: 'ready' as const,
        };
      }),
      resolveAttachment: jest.fn(async (_owner: string, _sender: string, eventId: string) => {
        if (eventId.endsWith('ffff')) {
          throw new Error('Attachment declares 8388609 bytes; v1 limit is 8388608 bytes (8 MiB)');
        }
        await StorageService.saveAttachment({
          ownerPubky: PUBKY_B,
          eventId,
          conversationId: `dm:${PUBKY_A}`,
          channelId: null,
          senderPubky: PUBKY_A,
          direction: 'received',
          location: `pubky://${PUBKY_A}/pub/hypercolor.app/v1/attachments/${eventId}`,
          keyRef: '',
          contentType: 'text/plain',
          size: 10,
          thumbnailLocation: null,
          localCachePath: 'file:///cache/b',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deliveryState: 'delivered',
          resolveState: 'ready',
        });
        await StorageService.saveLinkMessage({
          ownerPubky: PUBKY_B,
          eventId,
          conversationId: `dm:${PUBKY_A}`,
          peerPubky: PUBKY_A,
          senderPubky: PUBKY_A,
          direction: 'received',
          kind: 'chat.attachment.v0',
          rawJson: JSON.stringify({
            version: 1,
            kind: 'chat.attachment.v0',
            event_id: eventId,
            key: '__keystore__',
            nonce: '__keystore__',
          }),
          body: '[attachment]',
          sentAt: Date.now(),
          receivedAt: Date.now(),
          deliveryState: 'delivered',
        });
        return 'file:///cache/b';
      }),
    };
    mockedKeyStore.getAttachmentSecret.mockResolvedValue({
      key: 'key',
      nonce: 'nonce',
      algorithm: 'XChaCha20Poly1305',
    });
    const report = await runAttachmentLiveProof(TWO, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      link,
      attachments,
      writeFixtureFile: async () => 'file:///cache/fixture.txt',
      readCacheFile: async () => Buffer.from('liveproof-attachment-v1').toString('base64'),
      getHomeserverBlob: async () => 'ciphertext',
      ...clockDeps(),
    });
    expect(report.ok).toBe(true);
    expect(report.steps.map(step => step.step)).toEqual(
      expect.arrayContaining([
        'send-attachment-a',
        'resolve-attachment-b',
        'attachment-invariants',
        'aad-path-bind',
        'over-limit-rejected',
      ]),
    );
    expect(ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it('P4 binds amount, rejects injection, and stays red without a wallet opener', async () => {
    const link = createProductLink();
    const payments = {
      requestPayment: jest.fn(async () => ({
        ownerPubky: PUBKY_A,
        peerPubky: PUBKY_B,
        direction: 'sent' as const,
        paymentRequestId: '00000000-0000-4000-8000-00000000d001',
        eventId: '00000000-0000-4000-8000-00000000e001',
        amountValue: '0.00002',
        amountAsset: 'btc',
        paymentReference: 'liveproof-handoff',
        endpointIds: ['btc-lightning-bolt11', 'btc-bitcoin-p2tr'],
        expiresAt: null,
        status: 'pending' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        proofJson: null,
        reason: null,
        pendingEventId: null,
        displayedPaymentHash: null,
        proofVerified: null,
      })),
    };
    const closed = await runPaymentHandoffLiveProof(TWO, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      link,
      payments,
      ...clockDeps(),
    });
    expect(closed.ok).toBe(false);
    expect(closed.steps.find(step => step.step === 'wallet-handoff-open')?.ok).toBe(false);
    expect(closed.steps.find(step => step.step === 'handoff-injection-closed')?.ok).toBe(true);
    expect(closed.steps.some(step => step.detail.includes('00112233'))).toBe(false);

    const opened: string[] = [];
    const green = await runPaymentHandoffLiveProof(TWO, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      link,
      payments,
      openWalletUri: async uri => {
        opened.push(uri);
      },
      canOpenWalletUri: async () => true,
      handoffRecorder: { opened },
      ...clockDeps(),
    });
    expect(green.ok).toBe(true);
    expect(opened[0]?.startsWith('lightning:')).toBe(true);
  });

  it('P5 exports, wipes, restores, and redacts the recovery code', async () => {
    const link = createProductLink();
    let snapshotJson = '';
    const backup = {
      exportBackup: jest.fn(async () => {
        const owner = mockedKeyStore.getPubky() ?? PUBKY_A;
        snapshotJson = JSON.stringify(await StorageService.collectOwnerBackup(owner));
        return { recoveryCode: 'RECOVERYCODE1234', path: 'pubky://owner/backup' };
      }),
      restoreBackup: jest.fn(async (code: string) => {
        if (code !== 'RECOVERYCODE1234') throw new Error(`bad code ${code}`);
        const owner = mockedKeyStore.getPubky() ?? PUBKY_A;
        await StorageService.importOwnerBackup(owner, JSON.parse(snapshotJson));
      }),
    };
    const report = await runBackupLiveProof(TWO, {
      native: mockedNative as unknown as PaykitLinkNativeApi,
      link,
      backup,
      keyStore: {
        setPubky: pubky => {
          mockedKeyStore.getPubky.mockReturnValue(pubky);
        },
        deleteLinkSession: () => undefined,
        clearAttachmentSecretsForOwner: async () => [],
        getAttachmentSecret: async () => null,
      },
      ...clockDeps(),
    });
    expect(report.ok).toBe(true);
    expect(report.steps.map(step => step.step)).toEqual(
      expect.arrayContaining([
        'export-backup',
        'wipe-local',
        'restore-backup',
        'assert-restored',
        'assert-not-restored',
      ]),
    );
    const logged = jest.mocked(console.log).mock.calls.map(args => args.join(' '));
    expect(logged.some(line => line.includes('RECOVERYCODE1234'))).toBe(false);
    expect(report.steps.some(step => step.detail.includes('RECOVERYCODE1234'))).toBe(false);
  });

  it('runNamedLiveProofs dispatches p0 without running native sendPrivateMessageJson', async () => {
    const link = createProductLink();
    const result = await runNamedLiveProofs(
      { ...TWO, rows: ['p0'] },
      {
        native: mockedNative as unknown as PaykitLinkNativeApi,
        link,
        ...clockDeps(),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.row).toBe('p0');
    expect(mockedNative.sendPrivateMessageJson).toBeUndefined();
  });
});
