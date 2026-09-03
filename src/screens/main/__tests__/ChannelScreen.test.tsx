import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { COPY } from '../../../copy/uxCopy';
import { color, radius } from '../../../theme';
import { PRIVATE_GROUP_MEMBER_CAP } from '../../../flags/config';
import { GROUP_MESSAGE_KIND, type GroupChannel, type GroupMessage } from '../../../types/group';
import { sendingNofM, sentToNofM } from '../../../ui/groupFanoutStatus';

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: {},
  startLinkRetryDrain: jest.fn(() => () => undefined),
}));

jest.mock('../../../services/KeyStore', () => ({
  KeyStore: {
    isInitialized: jest.fn(() => true),
    getPubky: jest.fn(() => null),
    getLinkSession: jest.fn(() => null),
  },
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {},
}));

jest.mock('../../../services/group/GroupService', () => ({
  GroupService: {},
  subscribeGroupEvents: jest.fn(() => () => undefined),
}));

import { ChannelScreenContent } from '../ChannelScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (state: { pubky: string }) => unknown) =>
    select({ pubky: 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo' }),
}));

jest.mock('../../../stores/sessionStatusStore', () => ({
  useSessionStatusStore: (
    select: (state: { setGroupUnreadCount: (n: number) => void }) => unknown,
  ) => select({ setGroupUnreadCount: () => undefined }),
}));

jest.mock('../../../components/ComposerAttachButton', () => ({
  ComposerAttachButton: () => null,
}));

jest.mock('../../../components/AttachmentBubble', () => ({
  AttachmentBubble: () => null,
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {},
}));

jest.mock('../../../services/group/GroupService', () => ({
  GroupService: {},
  subscribeGroupEvents: () => () => undefined,
}));

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const BOB = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';
const CHANNEL_ID = `${OWNER}:00000000-0000-4000-8000-00000000bbbb`;
const EVENT = '00000000-0000-4000-8000-00000000eeee';
const noop = () => undefined;

const channel: GroupChannel = {
  ownerPubky: OWNER,
  channelId: CHANNEL_ID,
  name: 'Crew',
  createdAt: 1,
  updatedAt: 1,
  createdBy: OWNER,
  isPublic: false,
  lastMessageAt: 1,
  membershipEpoch: 0,
};

const message: GroupMessage = {
  ownerPubky: OWNER,
  channelId: CHANNEL_ID,
  eventId: EVENT,
  senderPubky: OWNER,
  kind: GROUP_MESSAGE_KIND,
  body: 'hello group',
  rawJson: '{}',
  sentAt: 1,
  receivedAt: null,
  deliveryState: 'sending',
  replyToEventId: null,
  replyToAuthorPubky: null,
  targetEventId: null,
  targetAuthorPubky: null,
  editedAt: null,
  deleted: false,
};

function contentProps(
  overrides: Partial<React.ComponentProps<typeof ChannelScreenContent>> = {},
): React.ComponentProps<typeof ChannelScreenContent> {
  return {
    channel,
    messages: [message],
    attachments: [],
    members: [
      {
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        memberPubky: OWNER,
        role: 'admin',
        addedAt: 1,
        removedAt: null,
        status: 'active',
      },
      {
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        memberPubky: ALICE,
        role: 'member',
        addedAt: 1,
        removedAt: null,
        status: 'active',
      },
      {
        ownerPubky: OWNER,
        channelId: CHANNEL_ID,
        memberPubky: BOB,
        role: 'member',
        addedAt: 1,
        removedAt: null,
        status: 'active',
      },
    ],
    contacts: [],
    fanoutOutcomes: [],
    localPubky: OWNER,
    draft: '',
    replyTo: null,
    sending: false,
    loading: false,
    showMembers: false,
    addPubky: '',
    isAdmin: true,
    selfActive: true,
    memberCap: PRIVATE_GROUP_MEMBER_CAP,
    onBack: noop,
    onChangeDraft: noop,
    onSend: noop,
    actionMenuOpen: false,
    composerNotice: null,
    onOpenActionMenu: noop,
    onCloseActionMenu: noop,
    onComposerAction: noop,
    onReply: noop,
    onClearReply: noop,
    onToggleMembers: noop,
    onChangeAddPubky: noop,
    onReact: noop,
    onEdit: noop,
    onDelete: noop,
    onAddMember: noop,
    onRemoveMember: noop,
    onLeave: noop,
    onRefreshPublic: noop,
    retryableEventIds: new Set<string>(),
    onRetryFailed: noop,
    ...overrides,
  };
}

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

function outcome(
  recipientPubky: string,
  status: 'pending' | 'sent' | 'failed',
  reason: 'blocked' | null = null,
) {
  return {
    ownerPubky: OWNER,
    channelId: CHANNEL_ID,
    eventId: EVENT,
    senderPubky: OWNER,
    recipientPubky,
    status,
    reason,
    updatedAt: 1,
  };
}

describe('ChannelScreenContent fan-out labels', () => {
  it('renders Sending when every recipient is pending', async () => {
    const tree = await render(
      <ChannelScreenContent
        {...contentProps({
          fanoutOutcomes: [outcome(ALICE, 'pending'), outcome(BOB, 'pending')],
        })}
      />,
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(COPY.sending);
    expect(json).not.toContain('Sent to 0 of');
    expect(tree.root.findByProps({ accessibilityLabel: COPY.sending }).props.name).toBe(
      'checkmark-done',
    );
    const mineBubble = tree.root
      .findAllByProps({ testID: 'channelBubbleMine' })
      .find(node => node.props.style);
    expect(StyleSheet.flatten(mineBubble?.props.style)).toMatchObject({
      backgroundColor: color.brand,
    });
    expect(tree.root.findAllByProps({ testID: 'channelByteCap' })).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('uses MessageBubble alignment for incoming channel messages', async () => {
    const incoming = {
      ...message,
      eventId: 'evt-incoming',
      senderPubky: ALICE,
      body: 'from Alice',
      sentAt: message.sentAt + 1,
    };
    const incoming2 = {
      ...incoming,
      eventId: 'evt-incoming-2',
      sentAt: message.sentAt + 2,
      body: 'from Alice again',
    };
    const tree = await render(
      <ChannelScreenContent {...contentProps({ messages: [message, incoming, incoming2] })} />,
    );
    const theirsBubble = tree.root
      .findAllByProps({ testID: 'channelBubbleTheirs' })
      .find(node => node.props.style);
    expect(StyleSheet.flatten(theirsBubble?.props.style)).toMatchObject({
      backgroundColor: color.bubbleIncoming,
    });
    expect(
      tree.root
        .findAllByProps({ testID: 'channelBubbleTheirsAvatar' })
        .filter(
          node =>
            (node as unknown as { type: unknown }).type === 'View' &&
            node.props.accessibilityRole === 'image',
        ),
    ).toHaveLength(1);
    const theirsStyles = tree.root
      .findAllByProps({ testID: 'channelBubbleTheirs' })
      .filter(node => node.props.style)
      .map(node => StyleSheet.flatten(node.props.style));
    expect(theirsStyles.some(style => style.borderBottomLeftRadius !== radius.bubbleTail)).toBe(
      true,
    );
    expect(theirsStyles.some(style => style.borderBottomLeftRadius === radius.bubbleTail)).toBe(
      true,
    );
    await act(async () => {
      tree.unmount();
    });
  });

  it('renders Sending · N of M sent for mixed sent and pending', async () => {
    const tree = await render(
      <ChannelScreenContent
        {...contentProps({
          fanoutOutcomes: [outcome(ALICE, 'sent'), outcome(BOB, 'pending')],
        })}
      />,
    );
    expect(tree.root.findByProps({ accessibilityLabel: sendingNofM(1, 2) }).props.name).toBe(
      'checkmark-done',
    );
    await act(async () => {
      tree.unmount();
    });
  });

  it('renders Sent when every recipient succeeded', async () => {
    const tree = await render(
      <ChannelScreenContent
        {...contentProps({
          fanoutOutcomes: [outcome(ALICE, 'sent'), outcome(BOB, 'sent')],
          messages: [{ ...message, deliveryState: 'sent' }],
        })}
      />,
    );
    expect(tree.root.findByProps({ accessibilityLabel: COPY.sent }).props.name).toBe(
      'checkmark-done',
    );
    expect(JSON.stringify(tree.toJSON())).not.toContain('Sent to');
    await act(async () => {
      tree.unmount();
    });
  });

  it('renders Not delivered when every recipient failed', async () => {
    const tree = await render(
      <ChannelScreenContent
        {...contentProps({
          fanoutOutcomes: [outcome(ALICE, 'failed'), outcome(BOB, 'failed')],
          messages: [{ ...message, deliveryState: 'failed' }],
        })}
      />,
    );
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.notDelivered);
    await act(async () => {
      tree.unmount();
    });
  });

  it('renders Sent to N of M for mixed sent and failed', async () => {
    const tree = await render(
      <ChannelScreenContent
        {...contentProps({
          fanoutOutcomes: [outcome(ALICE, 'sent'), outcome(BOB, 'failed')],
          messages: [{ ...message, deliveryState: 'sent' }],
        })}
      />,
    );
    expect(tree.root.findByProps({ accessibilityLabel: sentToNofM(1, 2) }).props.name).toBe(
      'checkmark-done',
    );
    await act(async () => {
      tree.unmount();
    });
  });
});
