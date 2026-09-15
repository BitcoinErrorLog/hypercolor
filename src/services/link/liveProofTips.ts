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
  addPastedContact,
  type LiveProofConfig,
  type LiveProofReport,
  type ProductLiveProofDeps,
} from './liveProofShared';

/** BOLT-11 specification vector; amountless so it cannot encode a payable amount. */
const TIP_BOLT11_20U =
  'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';
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
        await addPastedContact(storage, pubkyA, pubkyB, now);
        await addPastedContact(storage, pubkyB, pubkyA, now);
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
