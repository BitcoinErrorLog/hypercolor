import {
  CHAT_KIND_BYTE_PROOF_FIXTURES,
  buildChatReceiptEnvelope,
  buildChatTagEnvelope,
  chatKindByteProofChannelId,
  parseChatReceiptV0,
  parseChatTagV0,
  serializedUtf8Bytes,
} from '../chatKindValidation';
import { CHAT_RECEIPT_KIND, CHAT_TAG_KIND, LINK_MESSAGE_MAX_BYTES } from '../link';

const { uuid, pubky, sentAt } = CHAT_KIND_BYTE_PROOF_FIXTURES;
const ctx = {
  senderPubky: pubky,
  ownerPubky: 'b'.repeat(52),
  peerTrust: 'accepted' as const,
  nowMs: sentAt,
};

describe('chat.tag.v0 / chat.receipt.v0 spec vectors', () => {
  it('matches byte proofs from kinds-v1.md', () => {
    const tagDm = {
      version: 1 as const,
      kind: CHAT_TAG_KIND,
      event_id: uuid,
      sent_at: sentAt,
      target_event_id: uuid,
      target_author_pubky: pubky,
      label: '👍',
      op: 'add' as const,
    };
    expect(serializedUtf8Bytes(tagDm)).toBe(268);

    const tagWorst = {
      version: 1 as const,
      kind: CHAT_TAG_KIND,
      event_id: uuid,
      sent_at: sentAt,
      target_event_id: uuid,
      target_author_pubky: pubky,
      label: 'w'.repeat(32),
      op: 'add' as const,
      channel_id: chatKindByteProofChannelId(),
    };
    expect(serializedUtf8Bytes(tagWorst)).toBe(401);

    const rcpt = (n: number, channel?: string) => {
      const body: Record<string, unknown> = {
        version: 1,
        kind: CHAT_RECEIPT_KIND,
        event_id: uuid,
        sent_at: sentAt,
        status: 'delivered',
        event_ids: Array.from({ length: n }, () => uuid),
      };
      if (channel) body.channel_id = channel;
      return serializedUtf8Bytes(body);
    };
    expect(rcpt(12)).toBe(615);
    expect(rcpt(16, chatKindByteProofChannelId())).toBe(876);
    expect(rcpt(20)).toBe(927);
    expect(rcpt(16)).toBe(771);
    expect(rcpt(17, chatKindByteProofChannelId())).toBe(915);
  });

  it('round-trips builders through parsers', () => {
    const tag = buildChatTagEnvelope({
      eventId: uuid,
      sentAt,
      targetEventId: uuid,
      targetAuthorPubky: pubky,
      label: 'ok',
      op: 'add',
    });
    const parsedTag = parseChatTagV0(tag.json, ctx);
    expect(parsedTag).toEqual({ ok: tag.envelope });

    const receipt = buildChatReceiptEnvelope({
      eventId: uuid,
      sentAt,
      status: 'read',
      eventIds: [uuid],
    });
    const parsedReceipt = parseChatReceiptV0(receipt.json, ctx);
    expect(parsedReceipt).toEqual({ ok: receipt.envelope });
  });

  it('rejects malformed and oversized known envelopes', () => {
    expect(parseChatTagV0('not-json', ctx)).toEqual({ error: 'not-json' });
    expect(
      parseChatTagV0(JSON.stringify({ version: 1, kind: CHAT_TAG_KIND, label: 'OK' }), ctx),
    ).toEqual({ error: 'bad-event-id' });
    const upper = buildChatTagEnvelope({
      eventId: uuid,
      sentAt,
      targetEventId: uuid,
      targetAuthorPubky: pubky,
      label: 'ok',
      op: 'add',
    });
    const badLabel = JSON.parse(upper.json) as Record<string, unknown>;
    badLabel.label = 'OK';
    expect(parseChatTagV0(JSON.stringify(badLabel), ctx)).toEqual({ error: 'invalid-label' });

    const seen = {
      version: 1,
      kind: CHAT_RECEIPT_KIND,
      event_id: uuid,
      sent_at: sentAt,
      status: 'seen',
      event_ids: [uuid],
    };
    expect(parseChatReceiptV0(JSON.stringify(seen), ctx)).toEqual({ error: 'invalid-status' });

    const seventeen = {
      version: 1,
      kind: CHAT_RECEIPT_KIND,
      event_id: uuid,
      sent_at: sentAt,
      status: 'delivered',
      event_ids: Array.from({ length: 17 }, () => uuid),
    };
    expect(parseChatReceiptV0(JSON.stringify(seventeen), ctx)).toEqual({ error: 'event-ids-cap' });

    const oversized = `${'{"version":1,"kind":"chat.tag.v0","pad":"'}${'x'.repeat(1200)}"}`;
    expect(oversized.length).toBeGreaterThan(LINK_MESSAGE_MAX_BYTES);
    expect(parseChatTagV0(oversized, ctx)).toEqual({ error: 'oversized' });
  });

  it('clamps future sent_at beyond five minutes', () => {
    const built = buildChatTagEnvelope({
      eventId: uuid,
      sentAt: sentAt + 6 * 60 * 1000,
      targetEventId: uuid,
      targetAuthorPubky: pubky,
      label: 'ok',
      op: 'add',
    });
    expect(parseChatTagV0(built.json, { ...ctx, nowMs: sentAt })).toEqual({ error: 'bad-sent-at' });
  });

  it('sorts receipt ids for canonical JSON', () => {
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const built = buildChatReceiptEnvelope({
      eventId: uuid,
      sentAt,
      status: 'delivered',
      eventIds: [b, a, a],
    });
    expect(built.envelope.event_ids).toEqual([a, b]);
  });
});
