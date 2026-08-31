import { ENDPOINT_BITCOIN_P2TR, ENDPOINT_LIGHTNING_BOLT11 } from '../../types/payment';
import { PaymentService } from '../payments/PaymentService';
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
 * Public mainnet bolt11 fixture (20u = 0.00002 BTC). Same vector as P4.
 * Used only as a published tip-list payload, never paid.
 */
const TIP_BOLT11_20U =
  'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';
const TIP_P2TR = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

export type TipListLiveProofDeps = ProductLiveProofDeps & {
  payments?: Pick<
    typeof PaymentService,
    'setMyTipEndpoints' | 'sendTipList' | 'getPeerTipEndpoints'
  >;
};

/**
 * Publishes A's payment endpoints, sends the private tip list over the
 * established Encrypted Link, and asserts B resolves the same payloads.
 */
export async function runTipListLiveProof(
  config: LiveProofConfig,
  deps: TipListLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, randomBytes, handshakeTimeoutMs, receiveTimeoutMs, pollIntervalMs } =
    resolveClock(deps);
  const link = deps.link ?? defaultLinkApi();
  const payments = deps.payments ?? PaymentService;
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

    if (
      !(await record('set-tip-endpoints-a', async () => {
        await switchToParty(link, partyA);
        const saved = await payments.setMyTipEndpoints([
          { identifier: ENDPOINT_LIGHTNING_BOLT11, payload: TIP_BOLT11_20U },
          { identifier: ENDPOINT_BITCOIN_P2TR, payload: TIP_P2TR },
        ]);
        if (saved.length < 2) throw new Error(`A published ${saved.length} tip endpoints`);
        const lightning = saved.find(row => row.identifier === ENDPOINT_LIGHTNING_BOLT11);
        if (!lightning || lightning.payload !== TIP_BOLT11_20U) {
          throw new Error('A lightning tip endpoint was not stored');
        }
        return `${saved.length} endpoints`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('send-tip-list-a', async () => {
        await switchToParty(link, partyA);
        await payments.sendTipList(pubkyB);
        return `sent to ${pubkyB}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('resolve-tip-list-b', async () => {
        await switchToParty(link, partyB);
        const tips = await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            await link.syncInbox([pubkyA]);
            return payments.getPeerTipEndpoints(pubkyA);
          },
          rows =>
            rows.some(
              row => row.identifier === ENDPOINT_LIGHTNING_BOLT11 && row.payload === TIP_BOLT11_20U,
            ) &&
            rows.some(row => row.identifier === ENDPOINT_BITCOIN_P2TR && row.payload === TIP_P2TR),
          'B tip list from A',
        );
        return `${tips.length} endpoints`;
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupProductParties(record, native, storage, [partyA, partyB]);
  }

  return report();
}
