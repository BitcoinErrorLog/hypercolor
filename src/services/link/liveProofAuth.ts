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
 * AppCert must already be valid in KeyStore (UKD/identity grant only).
 * Owner writes use the Paykit session from this flow, not AppCert.
 * This row does not mint an AppCert and does not wipe the session.
 */
export async function runRingAuthLiveProof(
  _config: { homeserverPubky?: string } = {},
  deps: AuthLiveProofDeps = {},
): Promise<LiveProofReport> {
  const { native, now, sleep, receiveTimeoutMs, pollIntervalMs } = resolveClock(deps);
  const enable = deps.enable ?? (() => LinkService.enable());
  const keyStore = deps.keyStore ?? KeyStore;
  const { record, failed, report } = createLiveProofRecorder(now, []);

  let flow: LinkEnableFlow | null = null;
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
        flow = await enable();
        authorizationUrl = flow.authorizationUrl;
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
        if (!flow) throw new Error('auth flow is missing');
        const enabled = await flow.awaitEnabled();
        return enabled.pubky;
      }))
    ) {
      return failed();
    }

    if (
      !(await record('assert-appcert', async () => {
        await pollUntil(
          now,
          sleep,
          receiveTimeoutMs,
          pollIntervalMs,
          () => keyStore.isAppCertValid(),
          valid => valid,
          'AppCert after Ring approval',
        );
        const pubky = keyStore.getPubky();
        if (!pubky || pubky.trim().length === 0) {
          throw new Error('AppCert is valid but no pubky is stored');
        }
        return pubky;
      }))
    ) {
      return failed();
    }
  } finally {
    await record('preserve-ring-session', async () => {
      return 'session kept for owner writes; AppCert kept for UKD/identity';
    });
  }

  return report();
}
