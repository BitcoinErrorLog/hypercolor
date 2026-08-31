import { CHAT_MESSAGE_KIND, buildDmConversationId } from '../../types/link';
import { StorageService } from '../StorageService';
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
  requireText,
  resolveClock,
  signupParty,
  switchToParty,
  type LiveProofConfig,
  type LiveProofReport,
  type ProductLiveProofDeps,
} from './liveProofShared';

/**
 * P0 product-path DMs: A→B and B→A go through LinkService.sendDm / syncInbox.
 * Asserts persisted link_messages rows, delivery-state transitions, and
 * event-id dedup on a replayed inbox poll.
 */
export async function runLinkServiceLiveProof(
  config: LiveProofConfig,
  deps: ProductLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, randomBytes, handshakeTimeoutMs, receiveTimeoutMs, pollIntervalMs } =
    resolveClock(deps);
  const link = deps.link ?? defaultLinkApi();
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
      !(await record('validate-config', async () => {
        requireText(config.homeserverPubky, 'homeserverPubky');
        requireText(config.signupTokenA, 'signupTokenA');
        requireText(config.signupTokenB, 'signupTokenB');
        return 'ok';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('generate-identities', async () =>
        generatePartySecrets([partyA, partyB], randomBytes, redactSecrets),
      ))
    ) {
      return failed();
    }

    if (!(await signupParty(record, native, config.homeserverPubky, partyA, config.signupTokenA))) {
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
      !(await record('add-contact-ab-paste', async () => {
        const ts = now();
        await storage.upsertContact({
          pubky: pubkyB,
          ownerPubky: pubkyA,
          trustScore: 0,
          isFollowing: false,
          isFollower: false,
          isMutual: false,
          addedManually: true,
          firstSeenAt: ts,
        });
        await storage.upsertContact({
          pubky: pubkyA,
          ownerPubky: pubkyB,
          trustScore: 0,
          isFollowing: false,
          isFollower: false,
          isMutual: false,
          addedManually: true,
          firstSeenAt: ts,
        });
        return 'A↔B addedManually';
      }))
    ) {
      return failed();
    }

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

    if (
      !(await record('accept-request-b', async () => {
        await switchToParty(link, partyB);
        const pending = await storage.getMessageRequest(pubkyB, pubkyA);
        if (pending?.status !== 'pending') {
          throw new Error(
            `B expected a pending message request from A, got ${pending?.status ?? 'none'}`,
          );
        }
        await link.acceptMessageRequest(pubkyA);
        const accepted = await storage.getMessageRequest(pubkyB, pubkyA);
        if (accepted?.status !== 'accepted') {
          throw new Error(`B accept did not promote the request (${accepted?.status ?? 'none'})`);
        }
        return `accepted ${pubkyA}`;
      }))
    ) {
      return failed();
    }

    let sentAEventId = '';
    let sentBEventId = '';

    if (
      !(await record('send-dm-a', async () => {
        await switchToParty(link, partyA);
        const sent = await link.sendDm(pubkyB, 'liveproof-a');
        sentAEventId = sent.eventId;
        const row = await storage.getLinkMessage(pubkyA, pubkyA, CHAT_MESSAGE_KIND, sent.eventId);
        if (!row) throw new Error('A outbound link_messages row missing after sendDm');
        if (row.deliveryState !== 'sending' && row.deliveryState !== 'sent') {
          throw new Error(`A outbound deliveryState is ${row.deliveryState}`);
        }
        if (row.body !== 'liveproof-a') throw new Error('A outbound body mismatch');
        return `${sent.eventId} ${row.deliveryState}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('sync-inbox-b', async () => {
        await switchToParty(link, partyB);
        const inbound = await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          () => link.syncInbox([pubkyA]),
          messages => messages.some(message => message.eventId === sentAEventId),
          'B syncInbox for A→B',
        );
        const hit = inbound.find(message => message.eventId === sentAEventId);
        if (!hit || hit.body !== 'liveproof-a') throw new Error('B did not receive liveproof-a');
        return hit.eventId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('persist-inbound-b', async () => {
        const row = await storage.getLinkMessage(pubkyB, pubkyA, CHAT_MESSAGE_KIND, sentAEventId);
        if (!row) throw new Error('B inbound link_messages row missing');
        if (row.deliveryState !== 'delivered') {
          throw new Error(`B inbound deliveryState is ${row.deliveryState}`);
        }
        if (row.body !== 'liveproof-a') throw new Error('B inbound body mismatch');
        if (row.conversationId !== buildDmConversationId(pubkyA)) {
          throw new Error('B inbound conversationId mismatch');
        }
        const outbound = await storage.getLinkMessage(
          pubkyA,
          pubkyA,
          CHAT_MESSAGE_KIND,
          sentAEventId,
        );
        if (!outbound) throw new Error('A outbound link_messages row missing after B receive');
        if (outbound.deliveryState !== 'sent') {
          throw new Error(`A outbound still ${outbound.deliveryState} after B receive`);
        }
        return `delivered ${sentAEventId}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('send-dm-b', async () => {
        await switchToParty(link, partyB);
        const sent = await link.sendDm(pubkyA, 'liveproof-b-reply');
        sentBEventId = sent.eventId;
        const row = await storage.getLinkMessage(pubkyB, pubkyB, CHAT_MESSAGE_KIND, sent.eventId);
        if (!row) throw new Error('B outbound link_messages row missing after sendDm');
        if (row.body !== 'liveproof-b-reply') throw new Error('B outbound body mismatch');
        return `${sent.eventId} ${row.deliveryState}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('sync-inbox-a', async () => {
        await switchToParty(link, partyA);
        const inbound = await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          () => link.syncInbox([pubkyB]),
          messages => messages.some(message => message.eventId === sentBEventId),
          'A syncInbox for B→A',
        );
        const hit = inbound.find(message => message.eventId === sentBEventId);
        if (!hit || hit.body !== 'liveproof-b-reply') {
          throw new Error('A did not receive liveproof-b-reply');
        }
        const row = await storage.getLinkMessage(pubkyA, pubkyB, CHAT_MESSAGE_KIND, sentBEventId);
        if (!row || row.deliveryState !== 'delivered') {
          throw new Error('A inbound row missing or not delivered');
        }
        return hit.eventId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('replay-inbox-dedup', async () => {
        await switchToParty(link, partyB);
        const before = await storage.getLinkMessagesForConversation(
          pubkyB,
          buildDmConversationId(pubkyA),
          200,
        );
        const matchingBefore = before.filter(
          row => row.eventId === sentAEventId && row.kind === CHAT_MESSAGE_KIND,
        );
        if (matchingBefore.length !== 1) {
          throw new Error(`expected 1 A→B row before replay, got ${matchingBefore.length}`);
        }
        const replayed = await link.syncInbox([pubkyA]);
        const replayHits = replayed.filter(message => message.eventId === sentAEventId);
        if (replayHits.length > 0) {
          throw new Error('replayed inbox poll returned a duplicate event to the caller');
        }
        const after = await storage.getLinkMessagesForConversation(
          pubkyB,
          buildDmConversationId(pubkyA),
          200,
        );
        const matchingAfter = after.filter(
          row => row.eventId === sentAEventId && row.kind === CHAT_MESSAGE_KIND,
        );
        if (matchingAfter.length !== 1) {
          throw new Error(`event-id dedup failed: ${matchingAfter.length} rows after replay`);
        }
        return `dedup ${sentAEventId}`;
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupProductParties(record, native, storage, [partyA, partyB]);
  }

  return report();
}
