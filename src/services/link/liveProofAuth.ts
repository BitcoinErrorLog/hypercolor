import { KeyStore } from '../KeyStore';
import { LinkService, type LinkEnableFlow } from './LinkService';
import {
  createLiveProofRecorder,
  pollUntil,
  resolveClock,
  type AuthLiveProofDeps,
  type LiveProofReport,
} from './liveProofShared';

/**
 * P6 product-path Ring auth: `startAuthFlow` / `awaitAuthApproval`
 * (`pubkyauth://` + HTTP relay), not `signupWithSecret`. After approval
 * the link-session alias must restore and the owner must be stored.
 * Owner writes use the Paykit session from this flow.
 * This row does not wipe the session.
 */
export async function runRingAuthLiveProof(
  _config: { homeserverPubky?: string } = {},
  deps: AuthLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, receiveTimeoutMs, pollIntervalMs } = resolveClock(deps);
  const enable = deps.enable ?? (() => LinkService.enable());
  const keyStore = deps.keyStore ?? KeyStore;
  const { record, failed, report } = createLiveProofRecorder(now, []);

  const auth: { flow: LinkEnableFlow | null } = { flow: null };
  let authorizationUrl = '';

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
      !(await record('start-auth-flow', async () => {
        auth.flow = await enable();
        authorizationUrl = auth.flow.authorizationUrl;
        if (!authorizationUrl.startsWith('pubkyauth:')) {
          throw new Error('authorization URL is not a pubkyauth: URL');
        }
        return authorizationUrl;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('open-auth-url', async () => {
        if (!deps.openAuthUrl) {
          throw new Error(
            'no auth URL opener attached; parent must pass openAuthUrl (Linking.openURL of the authorizationUrl as-is). Do not wrap the pubkyauth URL.',
          );
        }
        await deps.openAuthUrl(authorizationUrl);
        return authorizationUrl;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('await-auth-approval', async () => {
        if (!auth.flow) throw new Error('auth flow is missing');
        const enabled = await auth.flow.awaitEnabled();
        return enabled.pubky;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('assert-session-restore', async () => {
        const pubky = await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          async () => {
            const stored = keyStore.getPubky();
            const alias = keyStore.getLinkSession();
            if (!stored || stored.trim().length === 0 || !alias) return null;
            await native.adoptAuthSession(alias);
            return stored;
          },
          value => value != null && value.length > 0,
          'link-session alias restores after Ring approval',
        );
        if (!pubky) {
          throw new Error('no pubky is stored after Ring approval');
        }
        return pubky;
      }))
    ) {
      return failed();
    }
  } finally {
    auth.flow?.cancel();
    await record('preserve-ring-session', async () => {
      return 'session kept for owner writes';
    });
  }

  return report();
}
