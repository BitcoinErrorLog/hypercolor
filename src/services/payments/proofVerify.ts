import * as Crypto from 'expo-crypto';

const HEX64 = /^[0-9a-f]{64}$/i;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function extractBolt11Preimage(proof: Record<string, unknown>): string | null {
  if (typeof proof.data !== 'string') return null;
  if (!HEX64.test(proof.data)) return null;
  return proof.data.toLowerCase();
}

export async function bolt11PreimagePaymentHash(preimageHex: string): Promise<string | null> {
  if (!HEX64.test(preimageHex)) return null;
  const bytes = hexToBytes(preimageHex.toLowerCase());
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Verify a bolt11 preimage against a payment_hash we already possess from a
 * decoded invoice that was exchanged or displayed. Uses expo-crypto SHA-256
 * over the 32-byte preimage (not the hex string).
 */
export async function verifyBolt11Preimage(
  preimageHex: string,
  paymentHashHex: string,
): Promise<boolean> {
  if (!HEX64.test(paymentHashHex)) return false;
  const hashHex = await bolt11PreimagePaymentHash(preimageHex);
  return hashHex !== null && hashHex === paymentHashHex.toLowerCase();
}
