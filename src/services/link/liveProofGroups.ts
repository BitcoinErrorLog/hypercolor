import { v4 as uuidv4 } from 'uuid';
import {
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildPrivateChannelId,
} from '../../types/group';
import { GroupService } from '../group/GroupService';
import { applyGroupInbound } from '../group/applyGroupInbound';
import { StorageService } from '../StorageService';
import {
  addPastedContact,
  adoptAndProvision,
  cleanupProductParties,
  createLiveProofRecorder,
  defaultLinkApi,
  emptyParty,
  errorMessage,
  establishProductLink,
  generatePartySecrets,
  pollUntil,
  requirePartyField,
  requireText,
  resolveClock,
  signupParty,
  switchToParty,
  type LiveProofLinkApi,
  type LiveProofReport,
  type ProductLiveProofDeps,
  type ProofParty,
  type ThreePartyLiveProofConfig,
} from './liveProofShared';

export type GroupLiveProofDeps = ProductLiveProofDeps & {
  groups?: Pick<typeof GroupService, 'createChannel' | 'sendGroupMessage' | 'removeMember'>;
  applyGroupInboundFn?: typeof applyGroupInbound;
};

/**
 * P2 three-party private groups: membership fan-out, group message persist,
 * removal cutoff, founder-bound channel id, and sender-scoped event ids.
 */
export async function runGroupLiveProof(
  config: ThreePartyLiveProofConfig,
  deps: GroupLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, randomBytes, handshakeTimeoutMs, receiveTimeoutMs, pollIntervalMs } =
    resolveClock(deps);
  const link = deps.link ?? defaultLinkApi();
  const groups = deps.groups ?? GroupService;
  const applyInbound = deps.applyGroupInboundFn ?? applyGroupInbound;
  const storage = StorageService;
  const partyA = emptyParty('A');
  const partyB = emptyParty('B');
  const partyC = emptyParty('C');
  const redactSecrets = [config.signupTokenA, config.signupTokenB, config.signupTokenC];
  const { record, failed, report } = createLiveProofRecorder(now, redactSecrets);

  let channelId = '';
  let groupEventId = '';

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
      !(await record('add-contacts-paste', async () => {
        await addPastedContact(storage, pubkyA, pubkyB, now);
        await addPastedContact(storage, pubkyB, pubkyA, now);
        await addPastedContact(storage, pubkyA, pubkyC, now);
        await addPastedContact(storage, pubkyC, pubkyA, now);
        await addPastedContact(storage, pubkyB, pubkyC, now);
        await addPastedContact(storage, pubkyC, pubkyB, now);
        return 'A↔B A↔C B↔C addedManually';
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
      !(await record('establish-ac', async () =>
        establishProductLink(
          link,
          storage,
          partyA,
          partyC,
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
      !(await record('establish-bc', async () =>
        establishProductLink(
          link,
          storage,
          partyB,
          partyC,
          now,
          sleep,
          handshakeTimeoutMs,
          pollIntervalMs,
        ),
      ))
    ) {
      return failed();
    }

    // A initiates AB/AC, B initiates BC — responders hold the pending request.
    if (
      !(await record('accept-request-b', async () =>
        acceptPendingRequest(link, storage, partyB, pubkyA, 'A'),
      ))
    ) {
      return failed();
    }
    if (
      !(await record('accept-request-c', async () =>
        acceptPendingRequest(link, storage, partyC, pubkyA, 'A'),
      ))
    ) {
      return failed();
    }
    if (
      !(await record('accept-request-c-from-b', async () =>
        acceptPendingRequest(link, storage, partyC, pubkyB, 'B'),
      ))
    ) {
      return failed();
    }

    if (
      !(await record('create-channel-a', async () => {
        await switchToParty(link, partyA);
        const channel = await groups.createChannel('liveproof-group', [pubkyB, pubkyC]);
        channelId = channel.channelId;
        const bound = channel.channelId.startsWith(`${pubkyA}:`);
        if (!bound) throw new Error(`channel id is not founder-bound to A: ${channel.channelId}`);
        return channel.channelId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('membership-fanout', async () => {
        await switchToParty(link, partyB);
        try {
          await pollUntil(
            now,
            sleep,
            receiveTimeoutMs,
            pollIntervalMs,
            async () => {
              await link.syncInbox([pubkyA]);
              return storage.getGroupChannel(pubkyB, channelId);
            },
            channel => channel !== null,
            'B membership',
          );
        } catch (err) {
          const request = await storage.getMessageRequest(pubkyB, pubkyA);
          const unprocessed = await storage.getUnprocessedLinkStreamItems(pubkyB, pubkyA);
          const channel = await storage.getGroupChannel(pubkyB, channelId);
          throw new Error(
            `${errorMessage(err)}; request=${request?.status ?? 'none'} unprocessed=${unprocessed.length} channel=${channel ? 'yes' : 'no'}`,
          );
        }
        await switchToParty(link, partyC);
        try {
          await pollUntil(
            now,
            sleep,
            receiveTimeoutMs,
            pollIntervalMs,
            async () => {
              await link.syncInbox([pubkyA]);
              return storage.getGroupChannel(pubkyC, channelId);
            },
            channel => channel !== null,
            'C membership',
          );
        } catch (err) {
          const request = await storage.getMessageRequest(pubkyC, pubkyA);
          const unprocessed = await storage.getUnprocessedLinkStreamItems(pubkyC, pubkyA);
          const channel = await storage.getGroupChannel(pubkyC, channelId);
          throw new Error(
            `${errorMessage(err)}; request=${request?.status ?? 'none'} unprocessed=${unprocessed.length} channel=${channel ? 'yes' : 'no'}`,
          );
        }
        const bMember = await storage.getGroupMember(pubkyB, channelId, pubkyB);
        const cMember = await storage.getGroupMember(pubkyC, channelId, pubkyC);
        if (bMember?.status !== 'active' || cMember?.status !== 'active') {
          throw new Error('B or C is not an active member after fan-out');
        }
        return channelId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('group-message-a', async () => {
        await switchToParty(link, partyA);
        const sent = await groups.sendGroupMessage(channelId, 'liveproof-group-body');
        groupEventId = sent.eventId;
        await switchToParty(link, partyB);
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            await link.syncInbox([pubkyA]);
            return storage.getGroupMessage(pubkyB, channelId, pubkyA, sent.eventId);
          },
          row => row?.body === 'liveproof-group-body',
          'B group message',
        );
        await switchToParty(link, partyC);
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            await link.syncInbox([pubkyA]);
            return storage.getGroupMessage(pubkyC, channelId, pubkyA, sent.eventId);
          },
          row => row?.body === 'liveproof-group-body',
          'C group message',
        );
        return sent.eventId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('group-message-b', async () => {
        await switchToParty(link, partyB);
        const sent = await groups.sendGroupMessage(channelId, 'liveproof-group-body-b');
        await switchToParty(link, partyA);
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            await link.syncInbox([pubkyB]);
            return storage.getGroupMessage(pubkyA, channelId, pubkyB, sent.eventId);
          },
          row => row?.body === 'liveproof-group-body-b',
          'A group message from B',
        );
        return sent.eventId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('remove-c', async () => {
        await switchToParty(link, partyA);
        await groups.removeMember(channelId, pubkyC);
        await switchToParty(link, partyB);
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            await link.syncInbox([pubkyA]);
            return storage.getGroupMember(pubkyB, channelId, pubkyC);
          },
          member => member?.status === 'removed',
          'B apply remove C',
        );
        return 'C removed on A/B';
      }))
    ) {
      return failed();
    }

    if (
      !(await record('removed-c-message-rejected', async () => {
        await switchToParty(link, partyC);
        const late = await groups.sendGroupMessage(channelId, 'liveproof-after-remove');
        await switchToParty(link, partyA);
        await link.syncInbox([pubkyC]);
        await switchToParty(link, partyB);
        await link.syncInbox([pubkyC]);
        const onA = await storage.getGroupMessage(pubkyA, channelId, pubkyC, late.eventId);
        const onB = await storage.getGroupMessage(pubkyB, channelId, pubkyC, late.eventId);
        if (onA || onB) {
          throw new Error('C message after removal was persisted on A or B');
        }
        return late.eventId;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('forged-channel-and-event-rejected', async () => {
        const forgedChannelId = buildPrivateChannelId(pubkyA, uuidv4());
        const forgedCreate = buildGroupMembershipEnvelope({
          channelId: forgedChannelId,
          eventId: uuidv4(),
          sentAt: now(),
          op: 'create',
          name: 'forged',
          members: [pubkyA, pubkyC],
        });
        await applyInbound({
          ownerPubky: pubkyA,
          senderPubky: pubkyC,
          envelope: forgedCreate.envelope,
          rawJson: forgedCreate.json,
          receivedAt: now(),
          peerTrust: 'accepted',
        });
        if (await storage.getGroupChannel(pubkyA, forgedChannelId)) {
          throw new Error('forged channel_id from C was persisted on A');
        }

        const reused = buildGroupMessageEnvelope({
          channelId,
          eventId: groupEventId,
          sentAt: now(),
          body: 'reused-event-from-c',
        });
        const before = await storage.getGroupMessage(pubkyA, channelId, pubkyA, groupEventId);
        await applyInbound({
          ownerPubky: pubkyA,
          senderPubky: pubkyC,
          envelope: reused.envelope,
          rawJson: reused.json,
          receivedAt: now(),
          peerTrust: 'accepted',
        });
        const after = await storage.getGroupMessage(pubkyA, channelId, pubkyA, groupEventId);
        if (!before || !after || after.body !== before.body) {
          throw new Error("reused event_id from C mutated A's group message");
        }
        const cCopy = await storage.getGroupMessage(pubkyA, channelId, pubkyC, groupEventId);
        if (cCopy) {
          throw new Error("reused event_id from C was persisted as C's message");
        }
        return 'forged channel_id and reused event_id rejected';
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupProductParties(record, native, storage, [partyA, partyB, partyC]);
  }

  return report();
}

async function acceptPendingRequest(
  link: LiveProofLinkApi,
  storage: Pick<typeof StorageService, 'getMessageRequest'>,
  owner: ProofParty,
  peerPubky: string,
  peerLabel: string,
): Promise<string> {
  await switchToParty(link, owner);
  const ownerPubky = requirePartyField(owner.pubky, `${owner.label}.pubky`);
  const pending = await storage.getMessageRequest(ownerPubky, peerPubky);
  if (pending?.status !== 'pending') {
    throw new Error(
      `${owner.label} expected a pending message request from ${peerLabel}, got ${pending?.status ?? 'none'}`,
    );
  }
  await link.acceptMessageRequest(peerPubky);
  const accepted = await storage.getMessageRequest(ownerPubky, peerPubky);
  if (accepted?.status !== 'accepted') {
    throw new Error(
      `${owner.label} accept did not promote the request (${accepted?.status ?? 'none'})`,
    );
  }
  return `accepted ${peerPubky}`;
}
