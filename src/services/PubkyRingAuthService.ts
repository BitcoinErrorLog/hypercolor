import { Linking } from 'react-native';
import { get as rnGet } from '@synonymdev/react-native-pubky';
import {
  x25519GenerateKeypair,
  sb2VerifySignature,
  sb2Decrypt,
} from '../utils/PubkyNoiseModule';
import { KeyStore } from './KeyStore';

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

/**
 * Generates an ephemeral X25519 keypair and opens pubky-ring with the
 * paykit-connect deep link. The user will be prompted to authorize.
 *
 * @param deviceId - An identifier for this device/session, e.g. "hypercolor-{timestamp}"
 */
export async function requestDelegation(deviceId: string): Promise<void> {
  const { secretKey: ephemeralSkHex, publicKey: ephemeralPkHex } =
    await x25519GenerateKeypair();

  _pending = { ephemeralSkHex };

  const callbackUrl = encodeURIComponent('hypercolor://ring-callback');

  const deepLink =
    `pubkyring://paykit-connect` +
    `?deviceId=${encodeURIComponent(deviceId)}` +
    `&callback=${callbackUrl}` +
    `&ephemeralPk=${encodeURIComponent(ephemeralPkHex)}`;

  const canOpen = await Linking.canOpenURL('pubkyring://');
  if (!canOpen) {
    _pending = null;
    throw new Error('pubky-ring is not installed on this device.');
  }
  await Linking.openURL(deepLink);
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
  const pubky = parsed.searchParams.get('pubky');
  const requestId = parsed.searchParams.get('request_id');
  const mode = parsed.searchParams.get('mode');
  const homeserver = parsed.searchParams.get('homeserver');

  if (!pubky || !requestId || !homeserver) {
    throw new Error(`Invalid callback URL — missing required params. Got: ${url}`);
  }
  if (mode !== 'secure_handoff') {
    throw new Error(`Unsupported handoff mode: ${mode}`);
  }
  if (!_pending) {
    throw new Error(
      'No pending delegation request. Call requestDelegation() before handling the callback.',
    );
  }

  const { ephemeralSkHex } = _pending;
  _pending = null;

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
  // `pubky` is the hex-encoded Ed25519 public key of the handoff owner.
  // The canonical storage path matches what pubky-ring used when encrypting.
  const storagePath = `/pub/paykit.app/v0/handoff/${requestId}`;

  const isValid = await sb2VerifySignature(envelopeBase64, pubky, storagePath);
  if (!isValid) {
    throw new Error('Handoff SB2 signature verification failed — possible tampering.');
  }

  // Decrypt using our ephemeral X25519 secret key (this is the `recipientInboxSkHex`).
  // pubky-ring encrypted to our ephemeralPk, so we decrypt with ephemeralSkHex.
  const decryptResult = await sb2Decrypt(envelopeBase64, ephemeralSkHex, pubky, storagePath);
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
  await KeyStore.setAppCert({
    certBodyHex: payload.app_key.cert_body,
    sigHex: payload.app_key.cert_sig,
    certIdHex: payload.app_key.cert_id,
    expiresAt: payload.expires_at,
  });
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

// ─── Utilities ────────────────────────────────────────────────────────────────

export function isPubkyRingInstalled(): Promise<boolean> {
  return Linking.canOpenURL('pubkyring://');
}

export const PubkyRingAuthService = {
  requestDelegation,
  handleRingCallback,
  isPubkyRingInstalled,
};
