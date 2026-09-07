import type { Contact, MessageRequest } from '../../src/types';
import type { LinkConversationSummary, LinkMessage } from '../../src/types/link';
import type { ChannelListItem } from '../../src/ui/channelList';
import {
  GROUP_MESSAGE_KIND,
  type GroupChannel,
  type GroupMember,
  type GroupMessage,
} from '../../src/types/group';
import {
  ENDPOINT_BITCOIN_P2TR,
  PAYMENT_ASSET_BTC,
  type TipEndpointRecord,
} from '../../src/types/payment';
import { mapPaymentReview, type PaymentReviewInput } from '../../src/ui/paymentReview';
import { SYNTHETIC_IDENTITIES } from './identities';

const { aster, bramble, cedar } = SYNTHETIC_IDENTITIES;
export const OWNER = cedar.pubky;
export const PEER = aster.pubky;
export const PEER_B = bramble.pubky;

export const FIXED_NOW_MS = 1_700_000_000_000;

export function contactFixture(patch: Partial<Contact> & Pick<Contact, 'pubky'>): Contact {
  return {
    ownerPubky: OWNER,
    trustScore: 50,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: FIXED_NOW_MS - 86_400_000,
    ...patch,
  };
}

export const CONTACTS_POPULATED: Contact[] = [
  contactFixture({
    pubky: aster.pubky,
    displayName: aster.name,
    isMutual: true,
    isFollowing: true,
    isFollower: true,
  }),
  contactFixture({
    pubky: bramble.pubky,
    displayName: bramble.name,
    isFollowing: true,
  }),
];

export const CHAT_ROWS: LinkConversationSummary[] = [
  {
    conversationId: `dm:${aster.pubky}`,
    participantPubky: aster.pubky,
    lastMessage: 'Hello from the fixture clock.',
    lastMessageAt: FIXED_NOW_MS - 120_000,
    lastKind: 'chat',
    unreadCount: 0,
  },
  {
    conversationId: `dm:${bramble.pubky}`,
    participantPubky: bramble.pubky,
    lastMessage: 'Payment request · synthetic',
    lastMessageAt: FIXED_NOW_MS - 3_600_000,
    lastKind: 'chat',
    unreadCount: 120,
  },
];

export function linkMessage(
  patch: Partial<LinkMessage> &
    Pick<LinkMessage, 'eventId' | 'direction' | 'body' | 'deliveryState'>,
): LinkMessage {
  const sender = patch.direction === 'sent' ? OWNER : PEER;
  return {
    ownerPubky: OWNER,
    conversationId: `dm:${PEER}`,
    peerPubky: PEER,
    senderPubky: sender,
    kind: 'chat.message.v0',
    rawJson: '{}',
    sentAt: FIXED_NOW_MS - 60_000,
    receivedAt: patch.direction === 'received' ? FIXED_NOW_MS - 59_000 : null,
    ...patch,
  };
}

export const THREAD_POPULATED: LinkMessage[] = [
  linkMessage({
    eventId: 'evt-theirs-1',
    direction: 'received',
    body: 'Hi — fixture message one.',
    deliveryState: 'delivered',
    sentAt: FIXED_NOW_MS - 180_000,
  }),
  linkMessage({
    eventId: 'evt-mine-1',
    direction: 'sent',
    body: 'Reply from the catalog fixture.',
    deliveryState: 'sent',
    sentAt: FIXED_NOW_MS - 60_000,
  }),
];

export const CHANNELS_POPULATED: ChannelListItem[] = [
  {
    ownerPubky: OWNER,
    channelId: 'chan-private-1',
    name: 'Fixture private group',
    createdAt: FIXED_NOW_MS - 86_400_000,
    updatedAt: FIXED_NOW_MS,
    createdBy: OWNER,
    isPublic: false,
    lastMessageAt: FIXED_NOW_MS - 600_000,
    membershipEpoch: 0,
    unreadCount: 3,
  },
  {
    ownerPubky: OWNER,
    channelId: 'chan-public-1',
    name: 'Fixture public topic',
    createdAt: FIXED_NOW_MS - 86_400_000,
    updatedAt: FIXED_NOW_MS,
    createdBy: OWNER,
    isPublic: true,
    lastMessageAt: FIXED_NOW_MS - 3_600_000,
    membershipEpoch: 0,
    unreadCount: 0,
  },
];

export const CHANNEL_FIXTURE: GroupChannel = {
  ownerPubky: OWNER,
  channelId: 'chan-private-1',
  name: 'Fixture private group',
  createdAt: FIXED_NOW_MS - 86_400_000,
  updatedAt: FIXED_NOW_MS,
  createdBy: OWNER,
  isPublic: false,
  lastMessageAt: FIXED_NOW_MS - 600_000,
  membershipEpoch: 0,
};

export const CHANNEL_MESSAGES: GroupMessage[] = [
  {
    ownerPubky: OWNER,
    channelId: CHANNEL_FIXTURE.channelId,
    eventId: 'g-evt-1',
    senderPubky: PEER,
    kind: GROUP_MESSAGE_KIND,
    body: 'Channel theirs fixture',
    rawJson: '{}',
    sentAt: FIXED_NOW_MS - 120_000,
    receivedAt: FIXED_NOW_MS - 119_000,
    deliveryState: 'delivered',
    replyToEventId: null,
    replyToAuthorPubky: null,
    targetEventId: null,
    targetAuthorPubky: null,
    editedAt: null,
    deleted: false,
  },
  {
    ownerPubky: OWNER,
    channelId: CHANNEL_FIXTURE.channelId,
    eventId: 'g-evt-2',
    senderPubky: OWNER,
    kind: GROUP_MESSAGE_KIND,
    body: 'Channel mine fixture',
    rawJson: '{}',
    sentAt: FIXED_NOW_MS - 60_000,
    receivedAt: null,
    deliveryState: 'sent',
    replyToEventId: null,
    replyToAuthorPubky: null,
    targetEventId: null,
    targetAuthorPubky: null,
    editedAt: null,
    deleted: false,
  },
];

export const CHANNEL_MEMBERS: GroupMember[] = [
  {
    ownerPubky: OWNER,
    channelId: CHANNEL_FIXTURE.channelId,
    memberPubky: OWNER,
    role: 'admin',
    addedAt: FIXED_NOW_MS - 86_400_000,
    removedAt: null,
    status: 'active',
  },
  {
    ownerPubky: OWNER,
    channelId: CHANNEL_FIXTURE.channelId,
    memberPubky: PEER,
    role: 'member',
    addedAt: FIXED_NOW_MS - 86_400_000,
    removedAt: null,
    status: 'active',
  },
];

export const REQUEST_PENDING = {
  request: {
    ownerPubky: OWNER,
    peerPubky: PEER,
    createdAt: FIXED_NOW_MS - 3_600_000,
    updatedAt: FIXED_NOW_MS - 3_600_000,
    status: 'pending',
  } satisfies MessageRequest,
  contact: contactFixture({ pubky: PEER, displayName: aster.name }),
};

export const AUTH_URL =
  'pubkyring://paykit-connect?deviceId=hypercolor-vrt&callback=hypercolor://ring-callback&ephemeralPk=00&caps=vrt';

export const ENABLE_AUTH_URL = 'pubkyauth://vrt-fixture-authorization';

const PAYMENT_REVIEW_ENDPOINT: TipEndpointRecord = {
  ownerPubky: OWNER,
  peerPubky: PEER,
  identifier: ENDPOINT_BITCOIN_P2TR,
  payload: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
  updatedAt: FIXED_NOW_MS,
  validationStatus: 'valid',
  invoiceAmount: null,
  invoiceExpiresAt: null,
  paymentHash: null,
};

export const PAYMENT_REVIEW_INPUT: PaymentReviewInput = {
  kind: 'request',
  recipientPubky: PEER,
  recipientContact: { displayName: aster.name, addedManually: true },
  requestAmountBtc: '0.00010000',
  amountAsset: PAYMENT_ASSET_BTC,
  reference: 'fixture-ref',
  endpoint: PAYMENT_REVIEW_ENDPOINT,
  destinations: [PAYMENT_REVIEW_ENDPOINT],
  nowMs: FIXED_NOW_MS,
  destinationsEmpty: false,
  walletUnavailable: false,
};

export const PAYMENT_REVIEW_FIXTURE = mapPaymentReview(PAYMENT_REVIEW_INPUT);

export const noop = (): void => undefined;

export const CONTACTS_BY_PUBKY: Record<string, Contact> = Object.fromEntries(
  CONTACTS_POPULATED.map(contact => [contact.pubky, contact]),
);

export const MESSAGE_REQUEST_ROWS = [
  { request: REQUEST_PENDING.request, contact: REQUEST_PENDING.contact },
];
