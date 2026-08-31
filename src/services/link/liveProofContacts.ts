import { ContactsService } from '../ContactsService';
import { StorageService } from '../StorageService';
import { classifyInboundPeer, wotInputFromContact } from './wotGate';
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
  type LiveProofReport,
  type ProductLiveProofDeps,
  type ThreePartyLiveProofConfig,
} from './liveProofShared';

export type ContactsLiveProofDeps = ProductLiveProofDeps & {
  contacts?: Pick<
    typeof ContactsService,
    'addManualContact' | 'syncRelationships' | 'importFollows'
  >;
};

/**
 * P1 contacts + WoT: A pastes B; inbound from B auto-accepts; inbound from C
 * lands in message requests. A unilateral follower bit does not open the gate.
 * Nexus import is skipped (and recorded) when unreachable.
 */
export async function runContactsLiveProof(
  config: ThreePartyLiveProofConfig,
  deps: ContactsLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, randomBytes, handshakeTimeoutMs, receiveTimeoutMs, pollIntervalMs } =
    resolveClock(deps);
  const link = deps.link ?? defaultLinkApi();
  const contacts = deps.contacts ?? ContactsService;
  const storage = StorageService;
  const partyA = emptyParty('A');
  const partyB = emptyParty('B');
  const partyC = emptyParty('C');
  const redactSecrets = [config.signupTokenA, config.signupTokenB, config.signupTokenC];
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
        requireText(config.signupTokenC, 'signupTokenC');
        return 'ok';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('generate-identities', async () =>
        generatePartySecrets([partyA, partyB, partyC], randomBytes, redactSecrets),
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
    if (!(await signupParty(record, native, config.homeserverPubky, partyC, config.signupTokenC))) {
      return failed();
    }
    if (!(await adoptAndProvision(record, link, partyA))) return failed();
    if (!(await adoptAndProvision(record, link, partyB))) return failed();
    if (!(await adoptAndProvision(record, link, partyC))) return failed();

    const pubkyA = requirePartyField(partyA.pubky, 'A.pubky');
    const pubkyB = requirePartyField(partyB.pubky, 'B.pubky');
    const pubkyC = requirePartyField(partyC.pubky, 'C.pubky');

    if (
      !(await record('add-contact-b-paste', async () => {
        await switchToParty(link, partyA);
        const added = await contacts.addManualContact(pubkyA, pubkyB);
        if (!added.ok) throw new Error(added.message);
        if (!added.contact.addedManually) throw new Error('B was not marked addedManually');
        return pubkyB;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('nexus-import', async () => {
        await switchToParty(link, partyA);
        try {
          const follows = await contacts.importFollows(pubkyA);
          const rel = await contacts.syncRelationships(pubkyA);
          if (!rel.nexusReachable) {
            const extra = !follows.ok ? follows.message : (rel.nexusError ?? 'unreachable');
            return `skipped nexus: ${extra}`;
          }
          return `following=${rel.following} followers=${rel.followers} friends=${rel.friends}`;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `skipped nexus: ${message}`;
        }
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
      !(await record('inbound-b-auto-accept', async () => {
        await switchToParty(link, partyB);
        const sent = await link.sendDm(pubkyA, 'wot-from-b');
        await switchToParty(link, partyA);
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          () => link.syncInbox([pubkyB]),
          messages => messages.some(message => message.eventId === sent.eventId),
          'A syncInbox auto-accept from B',
        );
        const request = await storage.getMessageRequest(pubkyA, pubkyB);
        if (request?.status === 'pending') {
          throw new Error('inbound from added/followed B was held as a message request');
        }
        const routed = await storage.countLinkMessagesForPeer(pubkyA, pubkyB);
        if (routed < 1) throw new Error('auto-accepted inbound from B was not routed');
        return `auto-accept ${sent.eventId}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('inbound-c-request', async () => {
        await switchToParty(link, partyC);
        await link.sendDm(pubkyA, 'wot-from-c');
        await switchToParty(link, partyA);
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            await link.syncInbox([pubkyC]);
            return storage.getMessageRequest(pubkyA, pubkyC);
          },
          row => row?.status === 'pending',
          'A message request from C',
        );
        const request = await storage.getMessageRequest(pubkyA, pubkyC);
        if (request?.status !== 'pending') {
          throw new Error('inbound from stranger C did not land in message requests');
        }
        const routed = await storage.getLinkMessagesForConversation(pubkyA, `dm:${pubkyC}`, 50);
        if (routed.length > 0) {
          throw new Error('stranger C inbound was routed into the main inbox');
        }
        return `pending ${pubkyC}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('unilateral-follower-closed', async () => {
        await storage.upsertContact({
          pubky: pubkyC,
          ownerPubky: pubkyA,
          trustScore: 0.9,
          isFollowing: false,
          isFollower: true,
          isMutual: false,
          addedManually: false,
          firstSeenAt: now(),
        });
        await storage.setContactRelationshipFlags(pubkyA, pubkyC, {
          isFollowing: false,
          isFollower: true,
          isMutual: false,
        });
        const contact = await storage.getContact(pubkyC, pubkyA);
        const decision = classifyInboundPeer(wotInputFromContact(contact, false));
        if (decision !== 'request') {
          throw new Error(`unilateral follower opened the gate: ${decision}`);
        }
        await switchToParty(link, partyA);
        await link.syncInbox([pubkyC]);
        const request = await storage.getMessageRequest(pubkyA, pubkyC);
        if (request?.status !== 'pending') {
          throw new Error('follower bit promoted C out of message requests');
        }
        return 'follower-bit-closed';
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupProductParties(record, native, storage, [partyA, partyB, partyC]);
  }

  return report();
}
