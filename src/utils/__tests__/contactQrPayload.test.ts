import { COPY } from '../../copy/uxCopy';
import { parseContactQrPayload } from '../contactQrPayload';
import { canonicalPubkyUri } from '../canonicalPubkyUri';

const VALID = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';

describe('parseContactQrPayload', () => {
  it('accepts canonical pubky://, compact pubky, bare z32, and pubky.app URLs', () => {
    expect(parseContactQrPayload(`pubky://${VALID}`)).toEqual({ ok: true, pubky: VALID });
    expect(parseContactQrPayload(`pubky${VALID}`)).toEqual({ ok: true, pubky: VALID });
    expect(parseContactQrPayload(VALID)).toEqual({ ok: true, pubky: VALID });
    expect(parseContactQrPayload(`https://pubky.app/profile/${VALID}`)).toEqual({
      ok: true,
      pubky: VALID,
    });
    expect(parseContactQrPayload(`https://www.pubky.app/${VALID}`)).toEqual({
      ok: true,
      pubky: VALID,
    });
  });

  it('rejects unknown payloads and forbidden z32 charset', () => {
    expect(parseContactQrPayload('https://example.com/profile')).toEqual({
      ok: false,
      message: COPY.notAPubkyQr,
    });
    expect(parseContactQrPayload('bitcoin:abc')).toEqual({
      ok: false,
      message: COPY.notAPubkyQr,
    });
    expect(parseContactQrPayload('0'.repeat(52))).toEqual({
      ok: false,
      message: COPY.notAPubkyQr,
    });
    expect(parseContactQrPayload('')).toEqual({ ok: false, message: COPY.notAPubkyQr });
  });
});

describe('canonicalPubkyUri', () => {
  it('emits pubky:// plus the 52-character z32', () => {
    expect(canonicalPubkyUri(VALID)).toBe(`pubky://${VALID}`);
  });
});
