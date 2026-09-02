/**
 * HMAC-SHA-256 for log correlation. Sync so {@link opaquePeerId} can stay
 * a log helper rather than an async pipeline. Not used for keys, sessions,
 * or any security decision. Implementation is @noble/hashes.
 */
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** Hex HMAC-SHA-256 of UTF-8 `message` (or raw bytes) under a hex key. */
export function hmacSha256Hex(keyHex: string, message: string | Uint8Array): string {
  const clean = keyHex.length % 2 === 0 ? keyHex : `0${keyHex}`;
  const key = hexToBytes(clean);
  const msg = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  return bytesToHex(hmac(sha256, key, msg));
}
