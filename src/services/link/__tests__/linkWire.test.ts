import {
  assertValidReceiverPath,
  buildChatMessageEnvelope,
  buildDmConversationId,
  CHAT_MESSAGE_KIND,
  CHAT_REACTION_KIND,
  CHAT_RECEIPT_KIND,
  decodeChatMessageEnvelope,
  decodeLinkEnvelope,
  decodePubkyAppDmEnvelope,
  isValidReceiverPath,
  LINK_MESSAGE_MAX_BYTES,
  LINK_RECEIVER_PATH,
  LINK_SENT_AT_UNIX_MS_MAX,
  parseDmConversationId,
  parseLinkSentAt,
  PUBKY_APP_DM_KIND,
} from '../../../types/link';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const SENT_AT = 1_700_000_000_000;
const PEER = 'z'.repeat(52);

describe('link wire contracts', () => {
  describe('kind constants', () => {
    it('locks the wire kind identifiers', () => {
      expect(CHAT_MESSAGE_KIND).toBe('chat.message.v0');
      expect(PUBKY_APP_DM_KIND).toBe('pubky_app.dm.v0');
      expect(CHAT_RECEIPT_KIND).toBe('chat.receipt.v0');
      expect(CHAT_REACTION_KIND).toBe('chat.reaction.v0');
    });
  });

  describe('receiver path', () => {
    it('uses the official hypercolor/wallet path', () => {
      expect(LINK_RECEIVER_PATH).toBe('hypercolor/wallet');
      expect(isValidReceiverPath(LINK_RECEIVER_PATH)).toBe(true);
    });

    it('rejects the invalid hypercolor/mobile path', () => {
      expect(isValidReceiverPath('hypercolor/mobile')).toBe(false);
      expect(() => assertValidReceiverPath('hypercolor/mobile')).toThrow('{app}/wallet');
    });

    it('accepts {app}/server', () => {
      expect(isValidReceiverPath('pubky-app/server')).toBe(true);
    });
  });

  describe('buildChatMessageEnvelope', () => {
    it('builds a valid envelope that round-trips through decode', () => {
      const { envelope, json, byteSize } = buildChatMessageEnvelope({
        eventId: EVENT_ID,
        sentAt: SENT_AT,
        body: 'hello world',
      });

      expect(envelope).toEqual({
        version: 1,
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT_ID,
        sent_at: SENT_AT,
        body: 'hello world',
      });
      expect(byteSize).toBeLessThanOrEqual(LINK_MESSAGE_MAX_BYTES);
      expect(decodeChatMessageEnvelope(json)).toEqual(envelope);
    });

    it('trims the body', () => {
      const { envelope } = buildChatMessageEnvelope({
        eventId: EVENT_ID,
        sentAt: SENT_AT,
        body: '  padded  ',
      });

      expect(envelope.body).toBe('padded');
    });

    it('throws on an empty or whitespace-only body', () => {
      expect(() =>
        buildChatMessageEnvelope({ eventId: EVENT_ID, sentAt: SENT_AT, body: '   ' }),
      ).toThrow('body must not be empty');
    });

    it('throws on a non-UUID event id', () => {
      expect(() =>
        buildChatMessageEnvelope({ eventId: 'not-a-uuid', sentAt: SENT_AT, body: 'hi' }),
      ).toThrow('event_id must be a UUID');
    });

    it('throws on a non-integer sent_at', () => {
      expect(() =>
        buildChatMessageEnvelope({ eventId: EVENT_ID, sentAt: 1.5, body: 'hi' }),
      ).toThrow('sent_at');
    });

    it('throws on a sent_at outside the Date range', () => {
      expect(() =>
        buildChatMessageEnvelope({ eventId: EVENT_ID, sentAt: 1e30, body: 'hi' }),
      ).toThrow('sent_at');
    });

    it('throws when the serialized envelope exceeds the byte ceiling', () => {
      expect(() =>
        buildChatMessageEnvelope({
          eventId: EVENT_ID,
          sentAt: SENT_AT,
          body: 'x'.repeat(LINK_MESSAGE_MAX_BYTES),
        }),
      ).toThrow('too long');
    });

    it('counts multi-byte UTF-8 against the byte budget', () => {
      // 300 four-byte emoji = 1200 bytes of body alone.
      expect(() =>
        buildChatMessageEnvelope({ eventId: EVENT_ID, sentAt: SENT_AT, body: '😀'.repeat(300) }),
      ).toThrow('too long');
    });
  });

  describe('decodeChatMessageEnvelope', () => {
    const valid = {
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: EVENT_ID,
      sent_at: SENT_AT,
      body: 'hi',
    };

    it('returns null for malformed JSON', () => {
      expect(decodeChatMessageEnvelope('{nope')).toBeNull();
    });

    it('returns null for non-object payloads', () => {
      expect(decodeChatMessageEnvelope('"just a string"')).toBeNull();
      expect(decodeChatMessageEnvelope('null')).toBeNull();
    });

    it('returns null for unknown kinds (legal on a shared link)', () => {
      expect(
        decodeChatMessageEnvelope(JSON.stringify({ ...valid, kind: CHAT_RECEIPT_KIND })),
      ).toBeNull();
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, kind: 'other.v0' }))).toBeNull();
    });

    it('returns null for a wrong version', () => {
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, version: 2 }))).toBeNull();
    });

    it('returns null for a missing or invalid event_id', () => {
      const withoutEventId: Partial<typeof valid> = { ...valid };
      delete withoutEventId.event_id;
      expect(decodeChatMessageEnvelope(JSON.stringify(withoutEventId))).toBeNull();
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, event_id: 'nope' }))).toBeNull();
    });

    it('returns null for a non-integer or non-positive sent_at', () => {
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, sent_at: 1.5 }))).toBeNull();
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, sent_at: -1 }))).toBeNull();
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, sent_at: '2026' }))).toBeNull();
    });

    it('returns null for sent_at outside the Date range', () => {
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, sent_at: 1e30 }))).toBeNull();
    });

    it('returns null for an empty body', () => {
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, body: '  ' }))).toBeNull();
    });

    it('accepts ISO-8601 sent_at and normalizes to epoch ms', () => {
      const iso = '2026-01-01T00:00:00.000Z';
      const decoded = decodeChatMessageEnvelope(JSON.stringify({ ...valid, sent_at: iso }));
      expect(decoded?.sent_at).toBe(Date.parse(iso));
    });
  });

  describe('parseLinkSentAt', () => {
    it('accepts a positive Unix-ms integer at the Date ceiling', () => {
      expect(parseLinkSentAt(LINK_SENT_AT_UNIX_MS_MAX)).toBe(LINK_SENT_AT_UNIX_MS_MAX);
      expect(parseLinkSentAt(1_756_742_400_000)).toBe(1_756_742_400_000);
    });

    it('rejects integers outside the Date range', () => {
      expect(parseLinkSentAt(1e30)).toBeNull();
      expect(parseLinkSentAt(8.64e15 + 1)).toBeNull();
      expect(parseLinkSentAt(2 ** 53 + 1)).toBeNull();
    });

    it('accepts a legacy ISO-8601 datetime and normalizes to Unix-ms', () => {
      expect(parseLinkSentAt('2026-08-21T10:00:00.000Z')).toBe(
        Date.parse('2026-08-21T10:00:00.000Z'),
      );
    });
  });

  describe('dual-kind decode', () => {
    const iso = '2026-01-15T12:00:00.000Z';

    it('decodes pubky_app.dm.v0 with ISO sent_at into the internal model', () => {
      const raw = JSON.stringify({
        version: 1,
        kind: PUBKY_APP_DM_KIND,
        event_id: EVENT_ID,
        sent_at: iso,
        body: 'from web',
      });
      expect(decodePubkyAppDmEnvelope(raw)).toEqual({
        version: 1,
        kind: PUBKY_APP_DM_KIND,
        event_id: EVENT_ID,
        sent_at: Date.parse(iso),
        body: 'from web',
      });
      expect(decodeLinkEnvelope(raw)?.kind).toBe(PUBKY_APP_DM_KIND);
    });

    it('decodes pubky_app.dm.v0 with epoch-ms sent_at', () => {
      const raw = JSON.stringify({
        version: 1,
        kind: PUBKY_APP_DM_KIND,
        event_id: EVENT_ID,
        sent_at: SENT_AT,
        body: 'from web',
      });
      expect(decodeLinkEnvelope(raw)?.sent_at).toBe(SENT_AT);
    });

    it('decodes chat.message.v0 with either timestamp form', () => {
      expect(
        decodeLinkEnvelope(
          JSON.stringify({
            version: 1,
            kind: CHAT_MESSAGE_KIND,
            event_id: EVENT_ID,
            sent_at: SENT_AT,
            body: 'hi',
          }),
        )?.sent_at,
      ).toBe(SENT_AT);
      expect(
        decodeLinkEnvelope(
          JSON.stringify({
            version: 1,
            kind: CHAT_MESSAGE_KIND,
            event_id: EVENT_ID,
            sent_at: iso,
            body: 'hi',
          }),
        )?.sent_at,
      ).toBe(Date.parse(iso));
    });
  });

  describe('conversation ids', () => {
    it('builds the dm:{counterpartyPubky} convention', () => {
      expect(buildDmConversationId(PEER)).toBe(`dm:${PEER}`);
    });

    it('round-trips through parse', () => {
      expect(parseDmConversationId(buildDmConversationId(PEER))).toEqual({
        counterpartyPubky: PEER,
      });
    });

    it('rejects ids without the dm: prefix', () => {
      expect(parseDmConversationId(PEER)).toBeNull();
      expect(parseDmConversationId(`channel:${PEER}`)).toBeNull();
    });

    it('rejects ids whose pubky segment has the wrong length', () => {
      expect(parseDmConversationId('dm:tooshort')).toBeNull();
      expect(parseDmConversationId(`dm:${'z'.repeat(53)}`)).toBeNull();
    });
  });
});
