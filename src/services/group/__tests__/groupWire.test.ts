import { LINK_MESSAGE_MAX_BYTES } from '../../../types/link';
import {
  GROUP_DELETE_KIND,
  GROUP_EDIT_KIND,
  GROUP_MEMBERSHIP_KIND,
  GROUP_MESSAGE_KIND,
  GROUP_REACTION_KIND,
  buildGroupDeleteEnvelope,
  buildGroupEditEnvelope,
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
  buildPublicChannelId,
  buildPublicChannelInvite,
  decodeGroupEnvelope,
  isGroupWireKind,
  packMembershipCreate,
  parsePublicChannelRef,
  peekEnvelopeKind,
} from '../../../types/group';

const EVENT = '00000000-0000-4000-8000-000000000001';
const TARGET = '00000000-0000-4000-8000-000000000002';
const CHANNEL = '00000000-0000-4000-8000-0000000000aa';
const SENT = 1_700_000_000_000;
const HOST = 'y'.repeat(52);

describe('group wire contracts', () => {
  it('locks the group kind identifiers', () => {
    expect(GROUP_MESSAGE_KIND).toBe('chat.group.message.v0');
    expect(GROUP_REACTION_KIND).toBe('chat.group.reaction.v0');
    expect(GROUP_EDIT_KIND).toBe('chat.group.edit.v0');
    expect(GROUP_DELETE_KIND).toBe('chat.group.delete.v0');
    expect(GROUP_MEMBERSHIP_KIND).toBe('chat.group.membership.v0');
    expect(isGroupWireKind(GROUP_MESSAGE_KIND)).toBe(true);
    expect(isGroupWireKind('chat.message.v0')).toBe(false);
  });

  it('emits reply_to_author and decodes its absence', () => {
    const withAuthor = buildGroupMessageEnvelope({
      channelId: CHANNEL,
      eventId: EVENT,
      sentAt: SENT,
      body: 'hello',
      replyTo: TARGET,
      replyToAuthor: HOST,
    });
    expect(withAuthor.envelope.reply_to).toBe(TARGET);
    expect(withAuthor.envelope.reply_to_author).toBe(HOST);
    expect(decodeGroupEnvelope(withAuthor.json)).toEqual(withAuthor.envelope);

    const withoutAuthor = JSON.parse(withAuthor.json) as Record<string, unknown>;
    delete withoutAuthor.reply_to_author;
    const decoded = decodeGroupEnvelope(JSON.stringify(withoutAuthor));
    expect(decoded).toEqual(
      expect.objectContaining({
        kind: GROUP_MESSAGE_KIND,
        reply_to: TARGET,
        body: 'hello',
      }),
    );
    expect(decoded && 'reply_to_author' in decoded ? decoded.reply_to_author : undefined).toBe(
      undefined,
    );
  });

  it('round-trips each private-group kind', () => {
    const message = buildGroupMessageEnvelope({
      channelId: CHANNEL,
      eventId: EVENT,
      sentAt: SENT,
      body: 'hello',
      replyTo: TARGET,
    });
    expect(decodeGroupEnvelope(message.json)).toEqual(message.envelope);

    const reaction = buildGroupReactionEnvelope({
      channelId: CHANNEL,
      eventId: EVENT,
      targetEventId: TARGET,
      targetAuthorPubky: HOST,
      emoji: '👍',
      sentAt: SENT,
    });
    expect(decodeGroupEnvelope(reaction.json)).toEqual(reaction.envelope);

    const edit = buildGroupEditEnvelope({
      channelId: CHANNEL,
      eventId: EVENT,
      targetEventId: TARGET,
      targetAuthorPubky: HOST,
      body: 'fixed',
      sentAt: SENT,
    });
    expect(decodeGroupEnvelope(edit.json)).toEqual(edit.envelope);

    const del = buildGroupDeleteEnvelope({
      channelId: CHANNEL,
      eventId: EVENT,
      targetEventId: TARGET,
      targetAuthorPubky: HOST,
      sentAt: SENT,
    });
    expect(decodeGroupEnvelope(del.json)).toEqual(del.envelope);

    const membership = buildGroupMembershipEnvelope({
      channelId: CHANNEL,
      eventId: EVENT,
      sentAt: SENT,
      op: 'create',
      name: 'Crew',
      members: [HOST],
    });
    expect(decodeGroupEnvelope(membership.json)).toEqual(membership.envelope);
  });

  it('rejects malformed known group kinds and peeks unknown kinds', () => {
    expect(decodeGroupEnvelope('{"kind":"chat.group.message.v0"}')).toBeNull();
    expect(
      decodeGroupEnvelope('{"version":1,"kind":"chat.group.message.v0","event_id":"x"}'),
    ).toBeNull();
    expect(
      decodeGroupEnvelope(
        JSON.stringify({
          version: 1,
          kind: GROUP_REACTION_KIND,
          channel_id: CHANNEL,
          event_id: EVENT,
          target_event_id: TARGET,
          emoji: '👍',
          sent_at: SENT,
        }),
      ),
    ).toBeNull();
    expect(peekEnvelopeKind('{"kind":"other.v0"}')).toBe('other.v0');
    expect(peekEnvelopeKind('not-json')).toBeNull();
  });

  it('packs create membership under the Noise byte ceiling', () => {
    const members = Array.from(
      { length: 50 },
      (_, i) => `${'y'.repeat(50)}${String(i).padStart(2, '0')}`,
    );
    const packed = packMembershipCreate({
      channelId: CHANNEL,
      eventId: EVENT,
      sentAt: SENT,
      name: 'Big',
      members,
    });
    expect(new TextEncoder().encode(packed.json).byteLength).toBeLessThanOrEqual(
      LINK_MESSAGE_MAX_BYTES,
    );
    expect(packed.envelope.op).toBe('create');
    expect(packed.overflow.length + (packed.envelope.members?.length ?? 0)).toBe(50);
  });

  it('parses public channel ids and invite links', () => {
    const localId = EVENT;
    const id = buildPublicChannelId(HOST, localId);
    expect(parsePublicChannelRef(id)).toEqual({ hostPubky: HOST, localId });
    const link = buildPublicChannelInvite(HOST, localId);
    expect(link.startsWith('hypercolor://join-public?channel=')).toBe(true);
    expect(parsePublicChannelRef(link)).toEqual({ hostPubky: HOST, localId });
    expect(
      parsePublicChannelRef(`hypercolor://join-public?channel=${localId}&host=${HOST}`),
    ).toEqual({ hostPubky: HOST, localId });
  });
});
