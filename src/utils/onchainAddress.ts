/**
 * Mainnet on-chain address checks.
 *
 * Bech32 / Bech32m checksums use `@scure/base` (same encoding library
 * `light-bolt11-decoder` uses). That is BIP-173 / BIP-350 encoding math,
 * not payment cryptography. Base58Check uses a local SHA-256 only to
 * verify the four-byte address checksum; payment preimage hashing uses
 * expo-crypto.
 */

import { bech32, bech32m } from '@scure/base';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAINNET = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BECH32_MAINNET_PREFIX = /^bc1[0-9a-z]{20,90}$/;

export function isValidMainnetBech32Address(address: string): boolean {
  if (!BECH32_MAINNET_PREFIX.test(address)) return false;
  if (address !== address.toLowerCase()) return false;
  try {
    const decoded = bech32.decode(address);
    return decoded.prefix === 'bc' && decoded.words[0] === 0;
  } catch {
    // Witness v0 uses bech32; v1+ uses bech32m.
  }
  try {
    const decoded = bech32m.decode(address);
    const version = decoded.words[0];
    return decoded.prefix === 'bc' && version !== undefined && version >= 1 && version <= 16;
  } catch {
    return false;
  }
}

// SECURITY BOUNDARY: this local SHA-256 exists ONLY for Base58Check address
// checksum verification — error detection on public data received over an
// already-authenticated E2E link. It provides no secrecy or authentication.
// NEVER reuse it for keys, signatures, proofs, or any security decision;
// security-relevant hashing goes through expo-crypto (native) or paykit-ffi.
function sha256(bytes: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLen = bytes.length * 8;
  const paddedLen = (bytes.length + 1 + 8 + 63) & ~63;
  const payload = new Uint8Array(paddedLen);
  payload.set(bytes);
  payload[bytes.length] = 0x80;
  const view = new DataView(payload.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function decodeBase58(payload: string): Uint8Array | null {
  const bytes = [0];
  for (const ch of payload) {
    const value = BASE58_ALPHABET.indexOf(ch);
    if (value < 0) return null;
    let carry = value;
    for (let i = bytes.length - 1; i >= 0; i--) {
      const next = (bytes[i] ?? 0) * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  for (const ch of payload) {
    if (ch !== '1') break;
    leading += 1;
  }
  const decoded = new Uint8Array(leading + bytes.length);
  decoded.set(bytes, leading);
  return decoded;
}

export function isValidMainnetBase58CheckAddress(address: string): boolean {
  if (!BASE58_MAINNET.test(address)) return false;
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length < 5) return false;
  const version = decoded[0];
  if (version !== 0x00 && version !== 0x05) return false;
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const hash = sha256(sha256(payload));
  return (
    hash[0] === checksum[0] &&
    hash[1] === checksum[1] &&
    hash[2] === checksum[2] &&
    hash[3] === checksum[3]
  );
}

export function isValidMainnetOnchainAddress(address: string): boolean {
  if (address.length === 0) return false;
  for (const ch of address) {
    const code = ch.charCodeAt(0);
    if (code <= 32 || code === 127) return false;
  }
  if (address.startsWith('bc1')) return isValidMainnetBech32Address(address);
  return isValidMainnetBase58CheckAddress(address);
}
