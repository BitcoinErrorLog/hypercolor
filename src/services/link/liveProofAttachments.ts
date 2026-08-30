import { Buffer } from 'buffer';
import { ATTACHMENT_MAX_BYTES } from '../../flags/config';
import {
  ATTACHMENT_KEY_PLACEHOLDER,
  CHAT_ATTACHMENT_KIND,
  isAttachmentLocationBoundToSender,
  parseAttachmentLocation,
} from '../../types/attachment';
import { buildDmConversationId } from '../../types/link';
import { AttachmentService } from '../attachments/AttachmentService';
import {
  attachmentCacheDirectory,
  readFileAsStandardBase64,
  writeFileFromStandardBase64,
} from '../attachments/fileIo';
import { PubkyService } from '../PubkyService';
import { KeyStore } from '../KeyStore';
import { StorageService } from '../StorageService';
import { PaykitLinkNative } from './PaykitLinkNative';
import {
  adoptAndProvision,
  cleanupProductParties,
  createLiveProofRecorder,
  defaultLinkApi,
  emptyParty,
  establishProductLink,
  generatePartySecrets,
  pollUntil,
  requirePartyField,
  requireLinkSession,
  requireText,
  resolveClock,
  signupParty,
  switchToParty,
  type LiveProofConfig,
  type LiveProofReport,
  type ProductLiveProofDeps,
  type RingKeyStoreApi,
} from './liveProofShared';

export type AttachmentLiveProofDeps = ProductLiveProofDeps & {
  attachments?: Pick<typeof AttachmentService, 'sendAttachment' | 'resolveAttachment'>;
  writeFixtureFile?: (standardB64: string, fileName: string) => Promise<string>;
  readCacheFile?: (uri: string) => Promise<string>;
  getHomeserverBlob?: (url: string) => Promise<string | null>;
  keyStore?: RingKeyStoreApi;
};

const FIXTURE_BODY = 'liveproof-attachment-v1';
const FIXTURE_B64 = Buffer.from(FIXTURE_BODY, 'utf8').toString('base64');

/**
 * P3 encrypted attachments: send a small fixture through AttachmentService,
 * resolve/decrypt on B, and check redaction, location bind, AAD, and size cap.
 */
export async function runAttachmentLiveProof(
  config: LiveProofConfig,
  deps: AttachmentLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, randomBytes, handshakeTimeoutMs, receiveTimeoutMs, pollIntervalMs } =
    resolveClock(deps);
  const link = deps.link ?? defaultLinkApi();
  const attachments = deps.attachments ?? AttachmentService;
  const storage = StorageService;
  const writeFixture = deps.writeFixtureFile ?? defaultWriteFixture;
  const readCache = deps.readCacheFile ?? defaultReadCache;
  const getBlob = deps.getHomeserverBlob ?? ((url: string) => PubkyService.get(url));
  const keyStore = deps.keyStore ?? KeyStore;
  const partyA = emptyParty('A');
  const partyB = emptyParty('B');
  const redactSecrets = [config.signupTokenA, config.signupTokenB];
  const { record, failed, report } = createLiveProofRecorder(now, redactSecrets);

  try {
    if (
      !(await record('native-available', async () => {
        if (!native.isAvailable()) {
          throw new Error('PaykitLinkModule native module is not available');
        }
        return 'available';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('require-link-session', async () => {
        const ring = requireLinkSession(keyStore);
        partyA.pubky = ring.pubky;
        partyA.sessionAlias = ring.sessionAlias;
        return ring.pubky;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('validate-config', async () => {
        requireText(config.homeserverPubky, 'homeserverPubky');
        requireText(config.signupTokenB, 'signupTokenB');
        return 'ok';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('generate-identities', async () =>
        generatePartySecrets([partyB], randomBytes, redactSecrets),
      ))
    ) {
      return failed();
    }

    if (!(await signupParty(record, native, config.homeserverPubky, partyB, config.signupTokenB))) {
      return failed();
    }
    if (!(await adoptAndProvision(record, link, partyA))) return failed();
    if (!(await adoptAndProvision(record, link, partyB))) return failed();

    const pubkyA = requirePartyField(partyA.pubky, 'A.pubky');
    const pubkyB = requirePartyField(partyB.pubky, 'B.pubky');

    if (
      !(await record('establish-ab', async () =>
        establishProductLink(
          link,
          storage,
          partyA,
          partyB,
          now,
          sleep,
          handshakeTimeoutMs,
          pollIntervalMs,
        ),
      ))
    ) {
      return failed();
    }

    const fixtureUri = await writeFixture(FIXTURE_B64, 'liveproof.txt');
    let sentEventId = '';
    let sentLocation = '';

    if (
      !(await record('send-attachment-a', async () => {
        await switchToParty(link, partyA);
        const sent = await attachments.sendAttachment(
          { type: 'conversation', peerPubky: pubkyB },
          fixtureUri,
          'text/plain',
        );
        if (sent.size > ATTACHMENT_MAX_BYTES) {
          throw new Error('fixture exceeded the 8 MiB v1 cap');
        }
        sentEventId = sent.eventId;
        sentLocation = sent.location;
        if (!isAttachmentLocationBoundToSender(sent.location, pubkyA)) {
          throw new Error('attachment location is not bound to A');
        }
        return sent.eventId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('resolve-attachment-b', async () => {
        await switchToParty(link, partyB);
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            await link.syncInbox([pubkyA]);
            return storage.getAttachment(pubkyB, pubkyA, sentEventId);
          },
          row => row !== null,
          'B attachment metadata',
        );
        const path = await attachments.resolveAttachment(pubkyB, pubkyA, sentEventId);
        const got = await readCache(path);
        const gotText = Buffer.from(got, 'base64').toString('utf8');
        if (gotText !== FIXTURE_BODY) {
          throw new Error('B decrypted plaintext does not match fixture');
        }
        return path;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('attachment-invariants', async () => {
        const row = await storage.getAttachment(pubkyB, pubkyA, sentEventId);
        if (!row) throw new Error('B attachment row missing');
        const parsed = parseAttachmentLocation(row.location);
        if (!parsed || parsed.ownerPubky !== pubkyA) {
          throw new Error('location owner is not A');
        }
        if (!isAttachmentLocationBoundToSender(row.location, pubkyA)) {
          throw new Error('location is not sender-bound to A');
        }
        const messages = await storage.getLinkMessagesForConversation(
          pubkyB,
          buildDmConversationId(pubkyA),
          200,
        );
        const access = messages.find(
          message => message.kind === CHAT_ATTACHMENT_KIND && message.eventId === sentEventId,
        );
        if (access && access.rawJson.includes('"key"') && !access.rawJson.includes(ATTACHMENT_KEY_PLACEHOLDER)) {
          if (!/"key"\s*:\s*"__keystore__"/.test(access.rawJson)) {
            throw new Error('content key leaked into SQLite raw_json');
          }
        }
        if (access?.rawJson.includes(ATTACHMENT_KEY_PLACEHOLDER) === false && access) {
          throw new Error('persisted attachment raw_json was not redacted');
        }
        return 'redacted + location-bound';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('aad-path-bind', async () => {
        const ciphertext = await getBlob(sentLocation);
        if (!ciphertext) throw new Error('ciphertext missing at sender location');
        const row = await storage.getAttachment(pubkyB, pubkyA, sentEventId);
        if (!row) throw new Error('B attachment row missing for AAD check');
        const secret = await KeyStore.getAttachmentSecret(pubkyB, pubkyA, sentEventId);
        if (!secret) throw new Error('attachment key missing in KeyStore for AAD check');
        try {
          await PaykitLinkNative.attachmentDecrypt(
            ciphertext,
            secret.key,
            secret.nonce,
            `${sentLocation}/tampered`,
          );
          throw new Error('decrypt succeeded with a wrong AAD path');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('wrong AAD path')) throw err;
          return 'aad mismatch rejected';
        }
      }))
    ) {
      return failed();
    }

    if (
      !(await record('over-limit-rejected', async () => {
        const oversizedId = '00000000-0000-4000-8000-00000000ffff';
        await storage.saveAttachment({
          ownerPubky: pubkyB,
          eventId: oversizedId,
          conversationId: buildDmConversationId(pubkyA),
          channelId: null,
          senderPubky: pubkyA,
          direction: 'received',
          location: sentLocation,
          keyRef: '',
          contentType: 'application/octet-stream',
          size: ATTACHMENT_MAX_BYTES + 1,
          thumbnailLocation: null,
          localCachePath: null,
          createdAt: now(),
          updatedAt: now(),
          deliveryState: 'delivered',
          resolveState: 'pending',
        });
        try {
          await attachments.resolveAttachment(pubkyB, pubkyA, oversizedId);
          throw new Error('over-limit resolve succeeded');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('over-limit resolve succeeded')) throw err;
          if (!/too-large|8 MiB|8388608|limit/i.test(message)) {
            throw new Error(`over-limit did not fail closed: ${message}`);
          }
          return 'over-limit rejected before download';
        }
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupProductParties(record, native, storage, [partyA, partyB]);
  }

  return report();
}

async function defaultWriteFixture(standardB64: string, fileName: string): Promise<string> {
  const path = `${attachmentCacheDirectory('liveproof')}fixtures/${fileName}`;
  await writeFileFromStandardBase64(path, standardB64);
  return path;
}

async function defaultReadCache(uri: string): Promise<string> {
  const { base64 } = await readFileAsStandardBase64(uri);
  return base64;
}
