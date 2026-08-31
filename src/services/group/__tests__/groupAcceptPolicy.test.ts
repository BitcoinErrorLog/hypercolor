import {
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
  requiresAcceptedPeer,
  type GroupEnvelope,
} from '../../../types/group';

const OWNER = 'a'.repeat(52);
const SENDER = 'z'.repeat(52);
const OTHER = 'y'.repeat(52);
const CHANNEL_ID = `${SENDER}:00000000-0000-4000-8000-00000000aaaa`;
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_EVENT_ID = '00000000-0000-4000-8000-000000000002';
const SENT_AT = 1_700_000_000_000;

function membership(
  op: 'create' | 'add' | 'remove' | 'leave',
  subjectPubky?: string,
): GroupEnvelope {
  return buildGroupMembershipEnvelope({
    channelId: CHANNEL_ID,
    eventId: EVENT_ID,
    sentAt: SENT_AT,
    op,
    ...(subjectPubky !== undefined ? { subjectPubky } : {}),
  }).envelope;
}

function message(): GroupEnvelope {
  return buildGroupMessageEnvelope({
    channelId: CHANNEL_ID,
    eventId: EVENT_ID,
    sentAt: SENT_AT,
    body: 'hello',
  }).envelope;
}

function reaction(): GroupEnvelope {
  return buildGroupReactionEnvelope({
    channelId: CHANNEL_ID,
    eventId: EVENT_ID,
    targetEventId: TARGET_EVENT_ID,
    targetAuthorPubky: SENDER,
    emoji: '🔥',
    sentAt: SENT_AT,
  }).envelope;
}

function gatedOnKnownChannel(envelope: GroupEnvelope): boolean {
  return requiresAcceptedPeer({ envelope, ownerPubky: OWNER, channelKnownLocally: true });
}

function gatedOnUnknownChannel(envelope: GroupEnvelope): boolean {
  return requiresAcceptedPeer({ envelope, ownerPubky: OWNER, channelKnownLocally: false });
}

describe('requiresAcceptedPeer', () => {
  it('gates create because the founder-bound channel id is sender-chosen', () => {
    expect(gatedOnKnownChannel(membership('create'))).toBe(true);
    expect(gatedOnUnknownChannel(membership('create'))).toBe(true);
  });

  it('gates an add whose subject is the recipient', () => {
    expect(gatedOnKnownChannel(membership('add', OWNER))).toBe(true);
  });

  it('allows an add naming someone else on a locally known channel', () => {
    expect(gatedOnKnownChannel(membership('add', OTHER))).toBe(false);
  });

  it('allows remove and leave on a locally known channel', () => {
    expect(gatedOnKnownChannel(membership('remove', OTHER))).toBe(false);
    expect(gatedOnKnownChannel(membership('leave', SENDER))).toBe(false);
  });

  it('allows content on a locally known channel: co-membership is its own trust context', () => {
    expect(gatedOnKnownChannel(message())).toBe(false);
    expect(gatedOnKnownChannel(reaction())).toBe(false);
  });

  it('gates everything for a channel the recipient does not know locally', () => {
    expect(gatedOnUnknownChannel(message())).toBe(true);
    expect(gatedOnUnknownChannel(reaction())).toBe(true);
    expect(gatedOnUnknownChannel(membership('add', OTHER))).toBe(true);
    expect(gatedOnUnknownChannel(membership('remove', OTHER))).toBe(true);
    expect(gatedOnUnknownChannel(membership('leave', SENDER))).toBe(true);
  });
});
