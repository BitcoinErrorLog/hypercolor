import { CHAT_MESSAGE_KIND } from '../../types/link';
import { EMPTY_PAYMENT_RECORD_EXTRAS } from '../../types/payment';
import { BackupService } from '../backup/BackupService';
import { KeyStore } from '../KeyStore';
import { StorageService } from '../StorageService';
import { resetLinkServiceHarnessState } from './LinkService';
import {
  adoptAndProvision,
  cleanupProductParties,
  createLiveProofRecorder,
  defaultLinkApi,
  emptyParty,
  generatePartySecrets,
  requirePartyField,
  requireRingAppCert,
  requireText,
  resolveClock,
  signupParty,
  switchToParty,
  type LiveProofConfig,
  type LiveProofReport,
  type ProductLiveProofDeps,
  type RingKeyStoreApi,
} from './liveProofShared';

const SNAPSHOT_MARKER = 'LIVEPROOF-DEVICE-SNAPSHOT';
const RECEIVER_ALIAS_MARKER = 'LIVEPROOF-RECEIVER-ALIAS';
const SESSION_ALIAS_MARKER = 'LIVEPROOF-SESSION-ALIAS';
const ATTACHMENT_KEY_MARKER = 'LIVEPROOF-ATTACHMENT-KEY';

export type BackupLiveProofDeps = ProductLiveProofDeps & {
  backup?: Pick<typeof BackupService, 'exportBackup' | 'restoreBackup'>;
  keyStore?: RingKeyStoreApi &
    Pick<typeof KeyStore, 'deleteLinkSession' | 'clearAttachmentSecretsForOwner' | 'getAttachmentSecret'>;
};

/**
 * P5 backup export / wipe / restore. Recovery codes are redacted. Device
 * secrets, Noise/session aliases, link snapshots, and attachment keys must
 * not be in the snapshot and must not come back after restore.
 */
export async function runBackupLiveProof(
  config: LiveProofConfig,
  deps: BackupLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, randomBytes } = resolveClock(deps);
  const link = deps.link ?? defaultLinkApi();
  const backup = deps.backup ?? BackupService;
  const keyStore = deps.keyStore ?? KeyStore;
  const storage = StorageService;
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
      !(await record('require-ring-appcert', async () => {
        const ring = await requireRingAppCert(keyStore);
        partyA.pubky = ring.pubky;
        partyA.sessionAlias = ring.sessionAlias;
        keyStore.setPubky(ring.pubky);
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

    const pubkyA = requirePartyField(partyA.pubky, 'A.pubky');
    const pubkyB = requirePartyField(partyB.pubky, 'B.pubky');
    const eventId = '00000000-0000-4000-8000-00000000b0b0';
    const paymentId = '00000000-0000-4000-8000-00000000p0p0';
    const channelId = `${pubkyA}:00000000-0000-4000-8000-00000000c0c0`;

    if (
      !(await record('seed-owner-data', async () => {
        await switchToParty(link, partyA);
        await storage.upsertContact({
          pubky: pubkyB,
          ownerPubky: pubkyA,
          displayName: 'Liveproof B',
          trustScore: 0.4,
          isFollowing: true,
          isFollower: false,
          isMutual: false,
          addedManually: true,
          firstSeenAt: now(),
        });
        await storage.upsertMessageRequest({
          ownerPubky: pubkyA,
          peerPubky: pubkyB,
          createdAt: now(),
          updatedAt: now(),
          status: 'accepted',
        });
        await storage.saveLinkMessage({
          ownerPubky: pubkyA,
          eventId,
          conversationId: `dm:${pubkyB}`,
          peerPubky: pubkyB,
          senderPubky: pubkyA,
          direction: 'sent',
          kind: CHAT_MESSAGE_KIND,
          rawJson: '{}',
          body: 'backup-dm',
          sentAt: now(),
          receivedAt: null,
          deliveryState: 'sent',
        });
        await storage.setLinkReadCursor(pubkyA, `dm:${pubkyB}`, now());
        await storage.upsertGroupChannel({
          ownerPubky: pubkyA,
          channelId,
          name: 'backup-group',
          createdAt: now(),
          updatedAt: now(),
          createdBy: pubkyA,
          isPublic: false,
          lastMessageAt: now(),
          membershipEpoch: 0,
        });
        await storage.upsertGroupMember({
          ownerPubky: pubkyA,
          channelId,
          memberPubky: pubkyA,
          role: 'admin',
          addedAt: now(),
          removedAt: null,
          status: 'active',
        });
        await storage.saveGroupMessage({
          ownerPubky: pubkyA,
          channelId,
          eventId,
          senderPubky: pubkyA,
          kind: 'chat.group.message.v0',
          body: 'backup-group-body',
          rawJson: '{}',
          sentAt: now(),
          receivedAt: null,
          deliveryState: 'sent',
          replyToEventId: null,
          replyToAuthorPubky: null,
          targetEventId: null,
          targetAuthorPubky: null,
          editedAt: null,
          deleted: false,
        });
        await storage.savePaymentRequest({
          ownerPubky: pubkyA,
          peerPubky: pubkyB,
          direction: 'sent',
          paymentRequestId: paymentId,
          eventId,
          amountValue: '0.00002',
          amountAsset: 'btc',
          paymentReference: 'backup-pay',
          endpointIds: ['btc-lightning-bolt11'],
          expiresAt: null,
          status: 'pending',
          createdAt: now(),
          updatedAt: now(),
          proofJson: null,
          reason: null,
          ...EMPTY_PAYMENT_RECORD_EXTRAS,
        });
        await storage.saveAttachment({
          ownerPubky: pubkyA,
          eventId,
          conversationId: `dm:${pubkyB}`,
          channelId: null,
          senderPubky: pubkyA,
          direction: 'sent',
          location: `pubky://${pubkyA}/pub/hypercolor.app/v1/attachments/${eventId}`,
          keyRef: `att:${pubkyA}:${pubkyA}:${eventId}`,
          contentType: 'text/plain',
          size: 12,
          thumbnailLocation: null,
          localCachePath: 'file:///cache/secret',
          createdAt: now(),
          updatedAt: now(),
          deliveryState: 'sent',
          resolveState: 'ready',
        });
        await storage.upsertLink({
          ownerPubky: pubkyA,
          peerPubky: pubkyB,
          role: 'initiator',
          status: 'established',
          snapshot: SNAPSHOT_MARKER,
          remoteNoisePublicKey: 'noise-b',
          localReceiverPath: '/pub/paykit.app/v0/receiver.json',
          remoteReceiverPath: '/pub/paykit.app/v0/receiver.json',
          consecutiveFailures: 0,
        });
        await storage.upsertLinkReceiver({
          ownerPubky: pubkyA,
          receiverAlias: RECEIVER_ALIAS_MARKER,
          receiverPath: '/pub/paykit.app/v0/receiver.json',
          markerPublished: true,
        });
        return 'seeded';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('snapshot-excludes-secrets', async () => {
        const snapshot = await storage.collectOwnerBackup(pubkyA);
        const serialized = JSON.stringify(snapshot);
        if (serialized.includes(SNAPSHOT_MARKER)) {
          throw new Error('snapshot JSON contains a link snapshot');
        }
        if (serialized.includes(RECEIVER_ALIAS_MARKER)) {
          throw new Error('snapshot JSON contains a Noise receiver alias');
        }
        if (serialized.includes(SESSION_ALIAS_MARKER)) {
          throw new Error('snapshot JSON contains a session alias');
        }
        if (serialized.includes(ATTACHMENT_KEY_MARKER) || serialized.includes('att:')) {
          throw new Error('snapshot JSON contains an attachment content key');
        }
        if (serialized.includes('file:///cache/secret')) {
          throw new Error('snapshot JSON contains an attachment cache path');
        }
        if (partyA.sessionAlias && serialized.includes(partyA.sessionAlias)) {
          throw new Error('snapshot JSON contains the live session alias');
        }
        if (snapshot.contacts.length < 1 || snapshot.linkMessages.length < 1) {
          throw new Error('snapshot is missing contacts or link messages');
        }
        return `contacts=${snapshot.contacts.length} messages=${snapshot.linkMessages.length}`;
      }))
    ) {
      return failed();
    }

    let recoveryCode = '';
    let backupPath = '';

    if (
      !(await record('export-backup', async () => {
        await switchToParty(link, partyA);
        const exported = await backup.exportBackup();
        recoveryCode = exported.recoveryCode;
        backupPath = exported.path;
        redactSecrets.push(recoveryCode);
        if (recoveryCode.length < 4) throw new Error('recovery code was empty');
        return `exported ${backupPath}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('wipe-local', async () => {
        await storage.clearAccountData(pubkyA);
        await native.clearAllNativeSecrets();
        keyStore.deleteLinkSession();
        await keyStore.clearAttachmentSecretsForOwner(pubkyA);
        try {
          resetLinkServiceHarnessState();
        } catch {
          // Optional: tests may stub LinkService without this seam.
        }
        if (await storage.getContact(pubkyB, pubkyA)) {
          throw new Error('contact survived wipe');
        }
        if ((await storage.getLinkMessagesForConversation(pubkyA, `dm:${pubkyB}`)).length > 0) {
          throw new Error('link messages survived wipe');
        }
        keyStore.setPubky(pubkyA);
        return 'wiped sqlite + native secrets';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('restore-backup', async () => {
        await backup.restoreBackup(recoveryCode);
        return 'restored';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('assert-restored', async () => {
        const contact = await storage.getContact(pubkyB, pubkyA);
        if (!contact || contact.displayName !== 'Liveproof B') {
          throw new Error('contact was not restored');
        }
        const request = await storage.getMessageRequest(pubkyA, pubkyB);
        if (!request) throw new Error('message request was not restored');
        const messages = await storage.getLinkMessagesForConversation(pubkyA, `dm:${pubkyB}`);
        if (messages.every(message => message.body !== 'backup-dm')) {
          throw new Error('link message history was not restored');
        }
        if ((await storage.getLinkReadCursor(pubkyA, `dm:${pubkyB}`)) === null) {
          throw new Error('read cursor was not restored');
        }
        const channel = await storage.getGroupChannel(pubkyA, channelId);
        if (!channel || channel.name !== 'backup-group') {
          throw new Error('group metadata was not restored');
        }
        const groupMessages = await storage.listGroupMessages(pubkyA, channelId, 20);
        if (groupMessages.every(message => message.body !== 'backup-group-body')) {
          throw new Error('group message was not restored');
        }
        const payment = await storage.getPaymentRequest(pubkyA, pubkyB, paymentId);
        if (!payment) throw new Error('payment request was not restored');
        const attachment = await storage.getAttachment(pubkyA, pubkyA, eventId);
        if (!attachment) throw new Error('attachment metadata was not restored');
        if (attachment.resolveState !== 'unavailable-from-backup') {
          throw new Error(`attachment resolveState is ${attachment.resolveState}`);
        }
        return 'contacts/messages/groups/payments/attachment-metadata';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('assert-not-restored', async () => {
        const linkRow = await storage.getLink(pubkyA, pubkyB);
        if (linkRow?.snapshot === SNAPSHOT_MARKER) {
          throw new Error('link snapshot was restored');
        }
        const receiver = await storage.getLinkReceiver(pubkyA);
        if (receiver?.receiverAlias === RECEIVER_ALIAS_MARKER) {
          throw new Error('Noise receiver alias was restored');
        }
        const secret = await keyStore.getAttachmentSecret(pubkyA, pubkyA, eventId);
        if (secret) throw new Error('attachment content key was restored');
        return 'noise/session/snapshot/attachment-keys stay unrestored';
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupProductParties(record, native, storage, [partyA, partyB]);
  }

  return report();
}
