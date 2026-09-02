import { utils } from '@scure/base';
import { isValidPubky, PUBKY_ZBASE32_ALPHABET } from '../../src/utils/pubkyId';

const pubkyZ32 = utils.chain(
  utils.radix2(5),
  utils.alphabet(PUBKY_ZBASE32_ALPHABET),
  utils.join(''),
);

function pubkyFromBytes(fill: number, tag: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(fill);
  bytes[0] = tag;
  bytes[31] = tag;
  const encoded = pubkyZ32.encode(bytes);
  if (!isValidPubky(encoded)) {
    throw new Error(`Synthetic fixture is not a valid pubky: ${encoded}`);
  }
  return encoded;
}

/**
 * Fixed identities for the catalog. Valid z32, obviously synthetic repeating
 * payloads from non-secret fill bytes. Never use Ring, KeyStore, or live keys.
 */
export const SYNTHETIC_IDENTITIES = Object.freeze({
  aster: Object.freeze({
    name: 'Aster Example',
    pubky: pubkyFromBytes(0x11, 0xa1),
    synthetic: true as const,
  }),
  bramble: Object.freeze({
    name: 'Bramble Example',
    pubky: pubkyFromBytes(0x22, 0xb2),
    synthetic: true as const,
  }),
  cedar: Object.freeze({
    name: 'Cedar Example',
    pubky: pubkyFromBytes(0x33, 0xc3),
    synthetic: true as const,
  }),
});

export const SYNTHETIC_PUBKY_ALLOWLIST: readonly string[] = Object.freeze(
  Object.values(SYNTHETIC_IDENTITIES).map(identity => identity.pubky),
);

/** Deliberately not a BIP-39 checksum. Mask if a scene ever renders it. */
export const SYNTHETIC_RECOVERY_CODE =
  'xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx';
