import { Linking } from 'react-native';
import { get as rnGet } from '@synonymdev/react-native-pubky';
import { x25519GenerateKeypair, sb2VerifySignature, sb2Decrypt } from '../utils/PubkyNoiseModule';
import { parsePubky, pubkyZ32ToHex } from '../utils/pubkyId';
import { RING_GRANT_CAPABILITIES } from '../types/link';
import { KeyStore, type AppCert } from './KeyStore';

/**
 * PubkyRingAuthService
 *
 * Implements the pubky-ring delegation protocol (paykit-connect flow v3):
 *
 *  1. Hypercolor generates an ephemeral X25519 keypair.
 *  2. Opens:  pubkyring://paykit-connect?deviceId=...&callback=hypercolor://ring-callback&ephemeralPk=...
 *  3. pubky-ring shows "Authorize App" UI. User approves.
 *  4. pubky-ring encrypts a handoff payload (SB2, to our ephemeralPk) and stores it at:
 *       pubky://{pubky}/pub/paykit.app/v0/handoff/{requestId}
 *     as a JSON wrapper: { "sb2": "<base64SB2Envelope>" }
 *  5. pubky-ring calls back:
 *       hypercolor://ring-callback?pubky={pubky}&request_id={requestId}&mode=secure_handoff&homeserver={homeserver}
 *  6. Hypercolor fetches the handoff JSON from the homeserver.
 *  7. Verifies + decrypts the SB2 envelope using the ephemeral X25519 secret key.
 *  8. Stores the delegated AppKey, AppCert, transport + inbox keypairs in KeyStore.
 *
 * The root Ed25519 secret key is NEVER seen or held by Hypercolor.
 */

// ─── Pending handoff state ────────────────────────────────────────────────────

interface PendingHandoff {
  ephemeralSkHex: string;
}

let _pending: PendingHandoff | null = null;

// ─── Step 1: Open pubky-ring ──────────────────────────────────────────────────

export function buildPaykitConnectUrl(deviceId: string, ephemeralPkHex: string): string {
  const callbackUrl = encodeURIComponent('hypercolor://ring-callback');
  // Advertised; Ring's PaykitConnectParams (inputParser.ts) ignores `caps`. Write caps come from Enable Messaging `pubkyauth`.
  return (
    `pubkyring://paykit-connect` +
    `?deviceId=${encodeURIComponent(deviceId)}` +
    `&callback=${callbackUrl}` +
    `&ephemeralPk=${encodeURIComponent(ephemeralPkHex)}` +
    `&caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}`
  );
}

/**
 * Generates an ephemeral X25519 keypair and builds the paykit-connect deep link.
 * Opens pubky-ring when it is installed on this device. Always returns `{ url }`
 * so Welcome can show a QR / copy on AwaitingRingAuth even if Ring is elsewhere.
 *
 * @param deviceId - An identifier for this device/session, e.g. "hypercolor-{timestamp}"
 */
export async function requestDelegation(deviceId: string): Promise<{ url: string }> {
  const { secretKey: ephemeralSkHex, publicKey: ephemeralPkHex } = await x25519GenerateKeypair();

  _pending = { ephemeralSkHex };
  await KeyStore.setPendingRingHandoff(ephemeralSkHex);

  const url = buildPaykitConnectUrl(deviceId, ephemeralPkHex);

  const canOpen = await Linking.canOpenURL('pubkyring://');
  if (canOpen) {
    await Linking.openURL(url);
  }
  return { url };
}

/**
 * AppCert from a Ring handoff. `payload.expires_at` is the 5-minute handoff
 * TTL, not cert expiry — Ring `issueAppCert(..., null)` issues no expiry.
 */
export function certFromHandoffAppKey(appKey: NonNullable<HandoffPayload['app_key']>): AppCert {
  return {
    certBodyHex: appKey.cert_body,
    sigHex: appKey.cert_sig,
    certIdHex: appKey.cert_id,
  };
}

export async function resolvePendingEphemeralSk(): Promise<string> {
  if (_pending?.ephemeralSkHex) return _pending.ephemeralSkHex;
  const persisted = await KeyStore.getPendingRingHandoff();
  if (persisted) return persisted;
  throw new Error(
    'No pending delegation request. Call requestDelegation() before handling the callback.',
  );
}

// ─── Step 2: Handle the callback from pubky-ring ─────────────────────────────

export interface DelegationResult {
  pubky: string;
  homeserver: string;
}

/**
 * Called when the app receives the `hypercolor://ring-callback?...` deep link.
 * Fetches and decrypts the pubky-ring handoff, then stores all delegated keys.
 */
export async function handleRingCallback(url: string): Promise<DelegationResult> {
  const parsed = new URL(url);
  const pubkyParam = parsed.searchParams.get('pubky');
  const requestId = parsed.searchParams.get('request_id');
  const mode = parsed.searchParams.get('mode');
  const homeserver = parsed.searchParams.get('homeserver');

  if (!pubkyParam || !requestId || !homeserver) {
    throw new Error(`Invalid callback URL — missing required params. Got: ${url}`);
  }
  if (mode !== 'secure_handoff') {
    throw new Error(`Unsupported handoff mode: ${mode}`);
  }

  // Ring puts z-base-32 in `pubky` (and `homeserver`). Homeserver stays z32 —
  // KeyStore / pkarr `resolveHttps` consume z32, not hex. SB2 native hex-parses
  // `ownerPeeridHex`, so convert the owner pubky once here.
  const pubky = parsePubky(pubkyParam);
  if (!pubky) {
    throw new Error('Invalid callback URL — pubky is not a 52-character z-base-32 key.');
  }
  const ownerPeeridHex = pubkyZ32ToHex(pubky);

  const ephemeralSkHex = await resolvePendingEphemeralSk();

  // ── Fetch handoff ──
  // pubky-ring stores: { "sb2": "<base64SB2Envelope>" }
  // at pubky://{pubky}/pub/paykit.app/v0/handoff/{requestId}
  const handoffUrl = `pubky://${pubky}/pub/paykit.app/v0/handoff/${requestId}`;
  const getResult = await rnGet(handoffUrl);
  if (!getResult.isOk() || !getResult.value) {
    throw new Error(`Handoff not found at ${handoffUrl}`);
  }

  const handoffJson = JSON.parse(getResult.value) as { sb2?: string };
  if (!handoffJson.sb2) {
    throw new Error('Handoff response is missing the "sb2" field.');
  }
  const envelopeBase64 = handoffJson.sb2;

  // ── Verify + decrypt ──
  // The canonical storage path matches what pubky-ring used when encrypting.
  const storagePath = `/pub/paykit.app/v0/handoff/${requestId}`;

  const isValid = await sb2VerifySignature(envelopeBase64, ownerPeeridHex, storagePath);
  if (!isValid) {
    throw new Error('Handoff SB2 signature verification failed — possible tampering.');
  }

  // Decrypt using our ephemeral X25519 secret key (this is the `recipientInboxSkHex`).
  // pubky-ring encrypted to our ephemeralPk, so we decrypt with ephemeralSkHex.
  const decryptResult = await sb2Decrypt(
    envelopeBase64,
    ephemeralSkHex,
    ownerPeeridHex,
    storagePath,
  );
  const payloadJson = Buffer.from(decryptResult.plaintext, 'hex').toString('utf8');
  const payload = JSON.parse(payloadJson) as HandoffPayload;

  if (!payload.app_key) {
    throw new Error(
      'pubky-ring handoff does not include an app_key. ' +
        'Ensure pubky-ring supports AppKey delegation (v3 handoff).',
    );
  }

  // ── Store all delegated keys ──
  await KeyStore.setAppKeypair({
    secretKey: payload.app_key.ed25519_sk,
    publicKey: payload.app_key.ed25519_pk,
  });
  await KeyStore.setAppCert(certFromHandoffAppKey(payload.app_key));
  await KeyStore.setInboxKeypair({
    secretKey: payload.inbox_keypair.secret_key,
    publicKey: payload.inbox_keypair.public_key,
  });

  // Use the first noise keypair (epoch 0) as the transport key
  const transportKeypair = payload.noise_keypairs[0];
  if (transportKeypair) {
    await KeyStore.setTransportKeypair({
      secretKey: transportKeypair.secret_key,
      publicKey: transportKeypair.public_key,
    });
  }

  KeyStore.setPubky(pubky);
  KeyStore.setHomeserver(homeserver);
  if (payload.session_secret) {
    KeyStore.setSessionSecret(payload.session_secret);
  }

  _pending = null;
  await KeyStore.clearPendingRingHandoff();

  return { pubky, homeserver };
}

// ─── Handoff payload shape ────────────────────────────────────────────────────
// Matches pubky-ring's HandoffPayload v3 (paykitConnectAction.ts).

interface HandoffPayload {
  version: number;
  pubky: string;
  session_secret?: string;
  capabilities?: string[];
  device_id?: string;
  noise_keypairs: Array<{
    epoch: number;
    public_key: string;
    secret_key: string;
  }>;
  noise_seed?: string;
  inbox_keypair: {
    public_key: string;
    secret_key: string;
  };
  /** Delegated app signing key + UKD AppCert */
  app_key?: {
    ed25519_sk: string;
    ed25519_pk: string;
    cert_id: string;
    cert_body: string;
    cert_sig: string;
  };
  created_at?: number;
  expires_at?: number;
}

export const PubkyRingAuthService = {
  requestDelegation,
  buildPaykitConnectUrl,
  handleRingCallback,
};
