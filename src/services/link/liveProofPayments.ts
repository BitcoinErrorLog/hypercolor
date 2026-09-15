import { ENDPOINT_BITCOIN_P2TR, ENDPOINT_LIGHTNING_BOLT11 } from '../../types/payment';
import { PaymentService } from '../payments/PaymentService';
import { buildPayUri, prepareRequestHandoff } from '../payments/walletHandoff';
import { StorageService } from '../StorageService';
import {
  adoptAndProvision,
  cleanupProductParties,
  createLiveProofRecorder,
  defaultLinkApi,
  emptyParty,
  establishProductLink,
  generatePartySecrets,
  requirePartyField,
  requireText,
  resolveClock,
  signupParty,
  switchToParty,
  type LiveProofConfig,
  type LiveProofReport,
  type ProductLiveProofDeps,
} from './liveProofShared';

/** BOLT-11 specification vector; amountless so it cannot encode a payable amount. */
const LIVEPROOF_BOLT11_20U =
  'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';
const LIVEPROOF_BOLT11_20U_BTC = '0.00002';
const LIVEPROOF_P2TR = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

export type PaymentHandoffRecorder = {
  opened: string[];
};

export type PaymentLiveProofDeps = ProductLiveProofDeps & {
  payments?: Pick<typeof PaymentService, 'requestPayment'>;
  prepareRequestHandoffFn?: typeof prepareRequestHandoff;
  buildPayUriFn?: typeof buildPayUri;
  /**
   * Parent attaches this when Bitkit (or a test scheme recorder) can receive
   * the validated URI. Dummy proofData hex never marks P4 green.
   */
  openWalletUri?: (uri: string) => Promise<void>;
  canOpenWalletUri?: (uri: string) => Promise<boolean>;
  handoffRecorder?: PaymentHandoffRecorder;
};

/**
 * P4 payment handoff: bind a real-looking amount to a validated lightning:/
 * bitcoin: URI, fail closed on injection, and expose a hook for Bitkit.
 * Does not invent a "Bitkit paid" success from dummy hex.
 */
export async function runPaymentHandoffLiveProof(
  config: LiveProofConfig,
  deps: PaymentLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, randomBytes, handshakeTimeoutMs } = resolveClock(deps);
  const link = deps.link ?? defaultLinkApi();
  const payments = deps.payments ?? PaymentService;
  const prepareHandoff = deps.prepareRequestHandoffFn ?? prepareRequestHandoff;
  const buildUri = deps.buildPayUriFn ?? buildPayUri;
  const storage = StorageService;
  const recorder = deps.handoffRecorder ?? { opened: [] };
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

    requirePartyField(partyA.pubky, 'A.pubky');
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
          deps.pollIntervalMs ?? 500,
        ),
      ))
    ) {
      return failed();
    }

    let requestAmount = '';
    let paymentRequestId = '';

    if (
      !(await record('build-payment-request', async () => {
        await switchToParty(link, partyA);
        const row = await payments.requestPayment(
          pubkyB,
          { value: LIVEPROOF_BOLT11_20U_BTC },
          'liveproof-handoff',
          [ENDPOINT_LIGHTNING_BOLT11, ENDPOINT_BITCOIN_P2TR],
        );
        requestAmount = row.amountValue;
        paymentRequestId = row.paymentRequestId;
        if (row.amountValue !== LIVEPROOF_BOLT11_20U_BTC) {
          throw new Error(`request amount ${row.amountValue} is not bound to the fixture`);
        }
        return `${row.paymentRequestId} ${row.amountValue}`;
      }))
    ) {
      return failed();
    }

    let validatedUri = '';

    if (
      !(await record('handoff-bind-amount', async () => {
        const lightning = prepareHandoff({
          requestAmountBtc: requestAmount,
          amountAsset: 'btc',
          endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
          payload: LIVEPROOF_BOLT11_20U,
        });
        if (!lightning.ok) throw new Error(lightning.error);
        if (lightning.requestAmountBtc !== requestAmount) {
          throw new Error('displayed request amount is not bound to the payment request');
        }
        if (lightning.invoiceAmountBtc !== null && lightning.invoiceAmountBtc !== requestAmount) {
          throw new Error('invoice amount is not bound to the request amount');
        }
        const onchain = prepareHandoff({
          requestAmountBtc: requestAmount,
          amountAsset: 'btc',
          endpointIdentifier: ENDPOINT_BITCOIN_P2TR,
          payload: LIVEPROOF_P2TR,
        });
        if (!onchain.ok) throw new Error(onchain.error);
        if (!onchain.uri.includes(`amount=${requestAmount}`)) {
          throw new Error('bitcoin: URI is not bound to the request amount');
        }
        const built = buildUri(ENDPOINT_LIGHTNING_BOLT11, LIVEPROOF_BOLT11_20U, requestAmount);
        if (built.uri !== lightning.uri) {
          throw new Error('buildPayUri and prepareRequestHandoff disagreed');
        }
        validatedUri = lightning.uri;
        return lightning.uri;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('handoff-injection-closed', async () => {
        const wrongScheme = prepareHandoff({
          requestAmountBtc: requestAmount,
          amountAsset: 'btc',
          endpointIdentifier: 'https-url',
          payload: 'https://evil.example',
        });
        if (wrongScheme.ok) throw new Error('wrong scheme was accepted');

        const swappedDest = prepareHandoff({
          requestAmountBtc: requestAmount,
          amountAsset: 'btc',
          endpointIdentifier: ENDPOINT_BITCOIN_P2TR,
          payload: 'javascript:alert(1)',
        });
        if (swappedDest.ok) throw new Error('swapped destination was accepted');

        try {
          buildUri(ENDPOINT_LIGHTNING_BOLT11, 'javascript:alert(1)');
          throw new Error('buildPayUri accepted a javascript: payload');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('buildPayUri accepted')) throw err;
        }
        return `closed request=${paymentRequestId}`;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('wallet-handoff-open', async () => {
        if (!deps.openWalletUri) {
          throw new Error(
            'no wallet opener attached; parent must pass openWalletUri (Linking.openURL of the validated URI) when Bitkit is present. Dummy proofData hex does not close P4.',
          );
        }
        if (deps.canOpenWalletUri) {
          const can = await deps.canOpenWalletUri(validatedUri);
          if (!can) {
            throw new Error('wallet opener cannot open the validated URI');
          }
        }
        await deps.openWalletUri(validatedUri);
        recorder.opened.push(validatedUri);
        if (recorder.opened[recorder.opened.length - 1] !== validatedUri) {
          throw new Error('handoff recorder did not receive the validated URI');
        }
        return validatedUri;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('p4-not-dummy-proof', async () => {
        return 'dummy proofData hex is not a P4 close; only a recorded wallet-handoff URI is';
      }))
    ) {
      return failed();
    }
  } finally {
    await cleanupProductParties(record, native, storage, [partyA, partyB]);
  }

  return report();
}
