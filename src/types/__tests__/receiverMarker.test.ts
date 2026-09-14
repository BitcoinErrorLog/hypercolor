import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  CHAT_KINDS_V,
  buildCapabilityDocument,
  parseCapabilityDocument,
  parseLegacyChatKindsV,
} from '../receiverMarker';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, '../../__fixtures__/receiver-marker', name), 'utf8');
const fixturePath = (name: string) =>
  path.join(__dirname, '../../__fixtures__/receiver-marker', name);
const sha256 = (filePath: string) =>
  createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const FIXTURE_SHA256 = {
  'capability.invalid.json': '219f71ea7b33abf29e6ec679aa0cb8d23acf451c20706dc64b158c59eb98c084',
  'capability.oversized.json': 'ca83c0814f76ff93cba312a88185fe4f56c04f52d700f270024fc27a8502cba5',
  'capability.valid.json': 'eead0640104ebefd1b6c830919d0eef4268784b7298d4bfbd0ea7ca40614dbbe',
  'capability.wrong-version.json':
    '5017b9e77f7a202eb1d83bcf4a8eff1ed999f41f53fdb7c470332c21985d1f86',
  'receiver-marker.unknown-field.json':
    '9726deb26e9bfd4e9d176a994dba5056ddca27c8a0b873a4ec247a28d6c443c5',
  'receiver-marker.valid.json': '9a29af4eec7d1086a57497125f151d41fff11ddf5b31ae22aa5cf25aaffa2269',
  'receiver-marker.wrong-receiver-path.json':
    '9cb1b3688029c8232d7c3a7139478cc4bd2bb376efda33457e39f5c87e51f39d',
} as const;

describe('strict Hypercolor capability document', () => {
  it('accepts the shared valid fixture and emits canonical JSON', () => {
    expect(parseCapabilityDocument(fixture('capability.valid.json'))).toEqual({ chatKindsV: 1 });
    expect(buildCapabilityDocument()).toBe(fixture('capability.valid.json').trim());
  });

  it.each([
    'capability.invalid.json',
    'capability.wrong-version.json',
    'capability.oversized.json',
  ])('rejects %s', name => {
    expect(parseCapabilityDocument(fixture(name))).toBeNull();
  });

  it('rejects duplicate keys, non-integers, and unknown fields', () => {
    expect(
      parseCapabilityDocument(
        '{"version":1,"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1}',
      ),
    ).toBeNull();
    expect(
      parseCapabilityDocument(
        '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1.5}',
      ),
    ).toBeNull();
    expect(
      parseCapabilityDocument(
        '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1,"noise_public_key":"x"}',
      ),
    ).toBeNull();
  });

  it('does not confuse string values or separate object scopes for duplicate keys', () => {
    expect(parseLegacyChatKindsV('{"note":"\\"version\\": harmless","chat_kinds_v":1}')).toBe(
      CHAT_KINDS_V,
    );
    expect(parseLegacyChatKindsV('{"chat_kinds_v":1,"nested":{"chat_kinds_v":2}}')).toBe(
      CHAT_KINDS_V,
    );
  });
});

describe('Release-N legacy read parser', () => {
  it('reads only chat_kinds_v and ignores key-shaped fields', () => {
    expect(parseLegacyChatKindsV('{"noise_public_key":"wrong","chat_kinds_v":1}')).toBe(
      CHAT_KINDS_V,
    );
    expect(parseLegacyChatKindsV('{"noise_public_key":"wrong"}')).toBe(0);
  });
});

describe('FFI-only production marker parsing', () => {
  it.each(Object.entries(FIXTURE_SHA256))('pins %s to its vendored SHA-256', (name, hash) => {
    expect(sha256(fixturePath(name))).toBe(hash);
  });

  it('does not expose a TypeScript production marker parser', () => {
    const source = fs.readFileSync(path.join(__dirname, '../receiverMarker.ts'), 'utf8');
    expect(source).not.toContain('parseProductionReceiverMarker');
    expect(source).not.toContain('parseReceiverMarkerJson');
  });
});
