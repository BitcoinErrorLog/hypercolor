import {
  buildChatMessageEnvelope,
  buildDmConversationId,
  CHAT_MESSAGE_KIND,
  CHAT_REACTION_KIND,
  CHAT_RECEIPT_KIND,
  decodeChatMessageEnvelope,
  LINK_MESSAGE_MAX_BYTES,
  parseDmConversationId,
} from '../../../types/link';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const SENT_AT = 1_700_000_000_000;
const PEER = 'z'.repeat(52);

describe('link wire contracts', () => {
  describe('kind constants', () => {
    it('locks the wire kind identifiers', () => {
      expect(CHAT_MESSAGE_KIND).toBe('chat.message.v0');
      expect(CHAT_RECEIPT_KIND).toBe('chat.receipt.v0');
      expect(CHAT_REACTION_KIND).toBe('chat.reaction.v0');
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

    it('returns null for an empty body', () => {
      expect(decodeChatMessageEnvelope(JSON.stringify({ ...valid, body: '  ' }))).toBeNull();
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
