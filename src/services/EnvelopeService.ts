import {
  sb2GenerateContextId,
  sb2Encrypt,
  sb2Sign,
  sb2Decrypt,
  sb2VerifySignature,
  sb2DecodeHeader,
  computeInboxKid,
  sealedBlobEncryptWithContext,
  sealedBlobDecryptWithContext,
} from '../utils/PubkyNoiseModule';
import { KeyStore } from './KeyStore';
import type { PubkyKey } from '../types';

/**
 * EnvelopeService — end-to-end encrypted message envelopes via pubky-noise.
 *
 * DM envelopes use the SB2 binary wire format (PUBKY_CRYPTO_SPEC v2.5 §7.2):
 *   - Encrypted to the recipient's X25519 InboxKey
 *   - Signed with the sender's delegated AppKey (with cert_id in header)
 *   - ownerPeeridHex = root pubky (storage owner), NOT the AppKey
 *   - Stored at: pubky://{sender}/pub/hypercolor.app/v1/outbox/{recipient}/{ts}.bin
 *
 * Channel envelopes use Sealed Blob v2 (spec-compliant AAD, §7.5):
 *   - Encrypted to the channel's X25519 inbox key
 *   - Each member holds the channel inbox secret key distributed at join time
 *   - Stored at: pubky://{sender}/pub/hypercolor.app/v1/channels/{channelId}/outbox/{ts}.bin
 *
 * All crypto is delegated to the pubky-noise Rust library via PubkyNoiseModule.
 */

const APP_PATH = '/pub/hypercolor.app/v1';

export interface PlainEnvelope {
  messageId: string;
  threadId?: string;
  channelId?: string;
  senderPubky: PubkyKey;
  content: string;
  createdAt: number;
}

function dmCanonicalPath(
  _senderPubky: PubkyKey,
  recipientPubky: PubkyKey,
  cursorMs: number,
): string {
  return `${APP_PATH}/outbox/${recipientPubky}/${cursorMs}.bin`;
}

function channelCanonicalPath(_senderPubky: PubkyKey, channelId: string, cursorMs: number): string {
  return `${APP_PATH}/channels/${channelId}/outbox/${cursorMs}.bin`;
}

function utf8ToHex(str: string): string {
  return Buffer.from(str, 'utf8').toString('hex');
}

// ─── inbox_kid cache ──────────────────────────────────────────────────────────
// Per PUBKY_CRYPTO_SPEC §5.3.2: cache { kid → true } so unknown kids on
// incoming messages can be rejected without calling Ring derivation (DoS).

let _localInboxKidHex: string | null = null;

async function getLocalInboxKid(): Promise<string> {
  if (_localInboxKidHex) return _localInboxKidHex;
  const inbox = await KeyStore.getInboxKeypair();
  if (!inbox) throw new Error('EnvelopeService: no InboxKeypair in KeyStore');
  _localInboxKidHex = await computeInboxKid(inbox.publicKey);
  return _localInboxKidHex;
}

/** Call when keys change (e.g. after re-authorization with pubky-ring). */
export function clearInboxKidCache(): void {
  _localInboxKidHex = null;
}

export const EnvelopeService = {
  /**
   * Encrypts a DM envelope using SB2 binary wire format.
   *
   * Per PUBKY_CRYPTO_SPEC v2.5 §7.2:
   * - ownerPeeridHex = root pubky (storage owner, from KeyStore.getPubky())
   * - senderPeeridHex = AppKey public key (delegated signer)
   * - cert_id in SB2 header signals delegated signature (verified via AppCert)
   */
  async encryptDM(
    senderPubky: PubkyKey,
    recipientInboxPkHex: string,
    recipientPubky: PubkyKey,
    envelope: PlainEnvelope,
    sb2ContextIdHex: string,
    cursorMs: number,
  ): Promise<string> {
    const appKeypair = await KeyStore.getAppKeypair();
    if (!appKeypair)
      throw new Error('EnvelopeService: no AppKey. Authorize with pubky-ring first.');

    const appCert = await KeyStore.getAppCert();
    if (!appCert) throw new Error('EnvelopeService: no AppCert. Authorize with pubky-ring first.');

    // ownerPeeridHex = root pubky (the identity that owns the homeserver namespace)
    const ownerPubky = KeyStore.getPubky();
    if (!ownerPubky) throw new Error('EnvelopeService: no root pubky in KeyStore.');

    const plaintextHex = utf8ToHex(JSON.stringify(envelope));
    const canonicalPath = dmCanonicalPath(senderPubky, recipientPubky, cursorMs);

    const envelopeBase64 = await sb2Encrypt(
      recipientInboxPkHex,
      plaintextHex,
      sb2ContextIdHex,
      envelope.messageId,
      'dm',
      ownerPubky, // ownerPeeridHex — root pubky, NOT AppKey
      appKeypair.publicKey, // senderPeeridHex — delegated AppKey
      recipientPubky, // recipientPeeridHex
      canonicalPath,
      Math.floor(envelope.createdAt / 1000),
      null,
      appCert.certIdHex, // cert_id — signals delegated signature
    );

    const signedBase64 = await sb2Sign(
      envelopeBase64,
      appKeypair.secretKey,
      ownerPubky, // ownerPeeridHex — root pubky for AAD
      canonicalPath,
    );

    return signedBase64;
  },

  /**
   * Generates a fresh random context ID for a new DM thread.
   * Store and reuse this ID for all messages within the same thread.
   */
  async generateContextId(): Promise<string> {
    return sb2GenerateContextId();
  },

  /**
   * Decrypts a DM SB2 envelope.
   *
   * Validates inbox_kid against our local cache before attempting
   * decryption (DoS prevention per §5.3.2). Optionally verifies
   * the sender's signature.
   */
  async decryptDM(
    recipientInboxSkHex: string,
    ownerPubky: PubkyKey,
    envelopeBase64: string,
    canonicalPath: string,
    verifySenderPubky?: string,
  ): Promise<PlainEnvelope> {
    // Validate inbox_kid before attempting decryption (DoS prevention §5.3.2)
    const localKid = await getLocalInboxKid();
    try {
      const header = await sb2DecodeHeader(envelopeBase64);
      if (header.inboxKidHex && header.inboxKidHex !== localKid) {
        throw new Error(
          `EnvelopeService: inbox_kid mismatch — envelope targets ${header.inboxKidHex}, ` +
            `local is ${localKid}. Rejecting.`,
        );
      }
    } catch (e) {
      if ((e as Error).message?.includes('inbox_kid mismatch')) throw e;
      // If header decode fails for other reasons, still attempt decrypt
      // (the Rust layer will reject invalid envelopes)
    }

    if (verifySenderPubky) {
      const valid = await sb2VerifySignature(envelopeBase64, verifySenderPubky, canonicalPath);
      if (!valid) throw new Error('EnvelopeService: SB2 signature verification failed');
    }

    const result = await sb2Decrypt(envelopeBase64, recipientInboxSkHex, ownerPubky, canonicalPath);

    const plaintext = Buffer.from(result.plaintext, 'hex').toString('utf8');
    return JSON.parse(plaintext) as PlainEnvelope;
  },

  /**
   * Encrypts a channel message envelope using Sealed Blob v2 with spec-compliant AAD.
   */
  encryptChannel(
    channelInboxPkHex: string,
    channelOwnerPubky: PubkyKey,
    channelId: string,
    cursorMs: number,
    envelope: PlainEnvelope,
  ): Promise<string> {
    const plaintextHex = utf8ToHex(JSON.stringify(envelope));
    const canonicalPath = channelCanonicalPath(envelope.senderPubky, channelId, cursorMs);
    return sealedBlobEncryptWithContext(
      channelInboxPkHex,
      plaintextHex,
      channelOwnerPubky,
      canonicalPath,
      'channel-msg',
    );
  },

  /**
   * Decrypts a channel message envelope.
   */
  async decryptChannel(
    channelInboxSkHex: string,
    channelOwnerPubky: PubkyKey,
    senderPubky: PubkyKey,
    channelId: string,
    cursorMs: number,
    envelopeJson: string,
  ): Promise<PlainEnvelope> {
    const canonicalPath = channelCanonicalPath(senderPubky, channelId, cursorMs);
    const plaintextHex = await sealedBlobDecryptWithContext(
      channelInboxSkHex,
      envelopeJson,
      channelOwnerPubky,
      canonicalPath,
    );
    const plaintext = Buffer.from(plaintextHex, 'hex').toString('utf8');
    return JSON.parse(plaintext) as PlainEnvelope;
  },

  clearInboxKidCache,
};
