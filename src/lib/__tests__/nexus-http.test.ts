import {
  NEXUS_MAX_BODY_BYTES,
  parseNexusJson,
  readNexusResponseText,
  utf8ByteLength,
} from '../nexus-http';

describe('nexus-http', () => {
  it('rejects a body over the byte cap from content-length', async () => {
    const response = {
      headers: {
        get: (name: string) =>
          name === 'content-length' ? String(NEXUS_MAX_BODY_BYTES + 1) : null,
      },
      body: { cancel: async () => undefined },
      text: async () => '{}',
    } as unknown as Response;
    expect(await readNexusResponseText(response)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('rejects a text body after the byte cap when no stream is present', async () => {
    const huge = 'x'.repeat(NEXUS_MAX_BODY_BYTES + 8);
    const response = {
      headers: { get: () => null },
      text: async () => huge,
    } as unknown as Response;
    expect(await readNexusResponseText(response)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('parses JSON under the cap and reports invalid JSON', () => {
    expect(parseNexusJson('{"ok":true}')).toEqual({ ok: true, value: { ok: true } });
    expect(parseNexusJson('not-json')).toEqual({ ok: false, reason: 'not-json' });
    expect(utf8ByteLength('ab')).toBe(2);
  });
});
