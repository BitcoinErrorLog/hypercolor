import {
  CHAT_KINDS_V,
  CHAT_KINDS_V_KEY,
  addChatKindsVToReceiverJson,
  buildReceiverMarkerPutBody,
  chatKindsVFromMarker,
  normalizeChatKindsV,
  parseReceiverMarkerJson,
} from '../receiverMarker';

describe('receiver.json chat_kinds_v parser', () => {
  it('treats absent and 0 as pre-v1', () => {
    expect(parseReceiverMarkerJson('{"noisePublicKey":"abc"}')?.chatKindsV).toBe(0);
    expect(parseReceiverMarkerJson(`{"${CHAT_KINDS_V_KEY}":0}`)?.chatKindsV).toBe(0);
    expect(normalizeChatKindsV(undefined)).toBe(0);
  });

  it('reads integer 1', () => {
    expect(parseReceiverMarkerJson(`{"${CHAT_KINDS_V_KEY}":1,"noisePublicKey":"n"}`)).toEqual({
      chatKindsV: 1,
      noisePublicKey: 'n',
    });
  });

  it('ignores unknown marker fields', () => {
    const parsed = parseReceiverMarkerJson(
      JSON.stringify({
        noisePublicKey: 'pk',
        [CHAT_KINDS_V_KEY]: 1,
        extra_future: { nested: true },
        another: 'x',
      }),
    );
    expect(parsed).toEqual({ chatKindsV: 1, noisePublicKey: 'pk' });
  });

  it('PUT body contains chat_kinds_v: 1', () => {
    const body = JSON.parse(buildReceiverMarkerPutBody({ noisePublicKey: 'noise' })) as {
      chat_kinds_v: number;
    };
    expect(body[CHAT_KINDS_V_KEY]).toBe(CHAT_KINDS_V);
  });

  it('adds chat_kinds_v without dropping existing fields', () => {
    const original =
      '{"noisePublicKey":"pk","capabilities":{"privatePayments":true},"extra":{"n":1}}';
    const merged = addChatKindsVToReceiverJson(original);
    expect(merged).toContain('"extra":{"n":1}');
    expect(merged).toContain('"capabilities":{"privatePayments":true}');
    expect(merged).toContain(`"${CHAT_KINDS_V_KEY}":${CHAT_KINDS_V}`);
    expect(merged?.startsWith('{"noisePublicKey":"pk"')).toBe(true);
  });

  it('returns null for a non-object GET body so callers skip PUT', () => {
    expect(addChatKindsVToReceiverJson('[]')).toBeNull();
    expect(addChatKindsVToReceiverJson('not-json')).toBeNull();
  });

  it('reads chatKindsV from the native marker object', () => {
    expect(chatKindsVFromMarker({ capabilitiesJson: '{}', chatKindsV: 1 })).toBe(1);
    expect(chatKindsVFromMarker({ capabilitiesJson: '{}' })).toBe(0);
  });
});
