import { v4 as uuidv4 } from 'uuid';
import { PRIVATE_GROUP_MEMBER_CAP } from '../../flags/config';
import type { DeliveryQueueItem, PubkyKey } from '../../types';
import {
  GROUP_DELETE_KIND,
  GROUP_EDIT_KIND,
  GROUP_MEMBERSHIP_KIND,
  GROUP_MESSAGE_KIND,
  GROUP_REACTION_KIND,
  PUBLIC_CHANNEL_MESSAGE_KIND,
  GroupServiceError,
  buildGroupDeleteEnvelope,
  buildGroupEditEnvelope,
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  buildGroupReactionEnvelope,
  buildPrivateChannelId,
  buildPublicChannelId,
  buildPublicChannelInvite,
  decodePublicChannelMessage,
  decodePublicChannelMeta,
  packMembershipCreate,
  parsePublicChannelId,
  parsePublicChannelRef,
  publicChannelMessageUrl,
  publicChannelMessagesPrefix,
  publicChannelMetaUrl,
  type GroupChannel,
  type GroupMember,
  type GroupMessage,
  type PublicChannelMessageDocument,
  type PublicChannelMeta,
} from '../../types/group';
import { KeyStore } from '../KeyStore';
import { StorageService } from '../StorageService';
import { PubkyService } from '../PubkyService';
import { LINK_GROUP_FANOUT_PAYLOAD_TYPE } from '../../types/group';
import { LinkService } from '../link/LinkService';
import { notifyGroupEvent } from './groupEvents';
import { groupDeliveryFromOutcomes } from '../../ui/groupFanoutStatus';

export { subscribeGroupEvents } from './groupEvents';
export { PRIVATE_GROUP_MEMBER_CAP };

let pendingPublicJoin: string | null = null;

export function setPendingPublicJoin(ref: string): void {
  pendingPublicJoin = ref;
}

export function takePendingPublicJoin(): string | null {
  const value = pendingPublicJoin;
  pendingPublicJoin = null;
  return value;
}

export const GroupService = {
  async listChannels(): Promise<GroupChannel[]> {
    return StorageService.listGroupChannels(requireOwner());
  },

  async getChannel(channelId: string): Promise<GroupChannel | null> {
    return StorageService.getGroupChannel(requireOwner(), channelId);
  },

  async listMembers(channelId: string): Promise<GroupMember[]> {
    return StorageService.listGroupMembers(requireOwner(), channelId);
  },

  async listMessages(channelId: string, limit = 100): Promise<GroupMessage[]> {
    return StorageService.listGroupMessages(requireOwner(), channelId, limit);
  },

  async isLocalAdmin(channelId: string): Promise<boolean> {
    const owner = requireOwner();
    const member = await StorageService.getGroupMember(owner, channelId, owner);
    return member?.status === 'active' && member.role === 'admin';
  },

  /**
   * Creates a private group. Creator is admin. Membership is announced by
   * pairwise fan-out of `chat.group.membership.v0` `{op:'create'}`.
   * Members without a ready Encrypted Link stay queued (same as DMs).
   */
  async createChannel(name: string, memberPubkys: PubkyKey[]): Promise<GroupChannel> {
    const owner = requireOwner();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new GroupServiceError('invalid-input', 'Channel name must not be empty');
    }
    const roster = uniquePubkys([owner, ...memberPubkys]);
    if (roster.length > PRIVATE_GROUP_MEMBER_CAP) {
      throw new GroupServiceError(
        'member-cap',
        `Private groups are limited to ${PRIVATE_GROUP_MEMBER_CAP} members`,
      );
    }
    const channelId = buildPrivateChannelId(owner, uuidv4());
    const ts = Date.now();
    const channel: GroupChannel = {
      ownerPubky: owner,
      channelId,
      name: trimmed,
      createdAt: ts,
      updatedAt: ts,
      createdBy: owner,
      isPublic: false,
      lastMessageAt: ts,
      membershipEpoch: 0,
    };
    await StorageService.upsertGroupChannel(channel);
    for (const memberPubky of roster) {
      await StorageService.upsertGroupMember({
        ownerPubky: owner,
        channelId,
        memberPubky,
        role: memberPubky === owner ? 'admin' : 'member',
        addedAt: ts,
        removedAt: null,
        status: 'active',
      });
    }

    const eventId = uuidv4();
    const packed = packMembershipCreate({
      channelId,
      eventId,
      sentAt: ts,
      name: trimmed,
      members: roster,
    });
    await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_MEMBERSHIP_KIND,
      eventId,
      sentAt: ts,
      body: 'create',
      rawJson: packed.json,
      replyToEventId: null,
      targetEventId: null,
    });

    for (const subject of packed.overflow) {
      if (subject === owner) continue;
      await fanOutMembershipOp(owner, channelId, 'add', subject);
    }

    notifyGroupEvent(owner, channelId);
    return channel;
  },

  async sendGroupMessage(
    channelId: string,
    body: string,
    replyTo?: { eventId: string; authorPubky: string },
  ): Promise<GroupMessage> {
    const owner = requireOwner();
    await requireActiveMember(owner, channelId, owner);
    const channel = await requirePrivateChannel(owner, channelId);
    const eventId = uuidv4();
    const sentAt = Date.now();
    const built =
      replyTo !== undefined
        ? buildGroupMessageEnvelope({
            channelId,
            eventId,
            sentAt,
            body,
            replyTo: replyTo.eventId,
            replyToAuthor: replyTo.authorPubky,
          })
        : buildGroupMessageEnvelope({ channelId, eventId, sentAt, body });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_MESSAGE_KIND,
      eventId,
      sentAt,
      body: built.envelope.body,
      rawJson: built.json,
      replyToEventId: built.envelope.reply_to ?? null,
      replyToAuthorPubky: built.envelope.reply_to_author ?? null,
      targetEventId: null,
    });
    await StorageService.touchGroupChannel(owner, channel.channelId, sentAt);
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async reactToMessage(
    channelId: string,
    targetEventId: string,
    emoji: string,
    targetAuthorPubky: PubkyKey,
  ): Promise<GroupMessage> {
    const owner = requireOwner();
    await requireActiveMember(owner, channelId, owner);
    await requirePrivateChannel(owner, channelId);
    const eventId = uuidv4();
    const sentAt = Date.now();
    const target = await StorageService.getGroupMessage(
      owner,
      channelId,
      targetAuthorPubky,
      targetEventId,
    );
    if (!target) {
      throw new GroupServiceError(
        'not-found',
        'Cannot react to a message that is not on this device',
      );
    }
    const built = buildGroupReactionEnvelope({
      channelId,
      eventId,
      targetEventId,
      targetAuthorPubky,
      emoji,
      sentAt,
    });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_REACTION_KIND,
      eventId,
      sentAt,
      body: built.envelope.emoji,
      rawJson: built.json,
      replyToEventId: null,
      targetEventId,
      targetAuthorPubky,
    });
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async editMessage(channelId: string, targetEventId: string, body: string): Promise<GroupMessage> {
    const owner = requireOwner();
    await requireActiveMember(owner, channelId, owner);
    await requirePrivateChannel(owner, channelId);
    const target = await StorageService.getGroupMessage(owner, channelId, owner, targetEventId);
    if (!target) {
      throw new GroupServiceError('not-found', 'Cannot edit a message that is not on this device');
    }
    if (target.senderPubky !== owner) {
      throw new GroupServiceError('not-author', 'Only the original author can edit a message');
    }
    const eventId = uuidv4();
    const sentAt = Date.now();
    const built = buildGroupEditEnvelope({
      channelId,
      eventId,
      targetEventId,
      targetAuthorPubky: owner,
      body,
      sentAt,
    });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_EDIT_KIND,
      eventId,
      sentAt,
      body: built.envelope.body,
      rawJson: built.json,
      replyToEventId: null,
      targetEventId,
      targetAuthorPubky: owner,
    });
    await StorageService.applyGroupMessageEdit(
      owner,
      channelId,
      owner,
      targetEventId,
      built.envelope.body,
      sentAt,
    );
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async deleteMessage(channelId: string, targetEventId: string): Promise<GroupMessage> {
    const owner = requireOwner();
    await requireActiveMember(owner, channelId, owner);
    await requirePrivateChannel(owner, channelId);
    const target = await StorageService.getGroupMessage(owner, channelId, owner, targetEventId);
    if (!target) {
      throw new GroupServiceError(
        'not-found',
        'Cannot delete a message that is not on this device',
      );
    }
    if (target.senderPubky !== owner) {
      throw new GroupServiceError('not-author', 'Only the original author can delete a message');
    }
    const eventId = uuidv4();
    const sentAt = Date.now();
    const built = buildGroupDeleteEnvelope({
      channelId,
      eventId,
      targetEventId,
      targetAuthorPubky: owner,
      sentAt,
    });
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId,
      senderPubky: owner,
      kind: GROUP_DELETE_KIND,
      eventId,
      sentAt,
      body: '',
      rawJson: built.json,
      replyToEventId: null,
      targetEventId,
      targetAuthorPubky: owner,
    });
    await StorageService.tombstoneGroupMessage(owner, channelId, owner, targetEventId);
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async addMember(channelId: string, memberPubky: PubkyKey): Promise<GroupMember> {
    const owner = requireOwner();
    await requireAdmin(owner, channelId);
    const channel = await requirePrivateChannel(owner, channelId);
    const existing = await StorageService.getGroupMember(owner, channelId, memberPubky);
    if (existing?.status === 'active') return existing;
    const active = await StorageService.countActiveGroupMembers(owner, channelId);
    if (active >= PRIVATE_GROUP_MEMBER_CAP) {
      throw new GroupServiceError(
        'member-cap',
        `Private groups are limited to ${PRIVATE_GROUP_MEMBER_CAP} members`,
      );
    }
    const ts = Date.now();
    const member: GroupMember = {
      ownerPubky: owner,
      channelId: channel.channelId,
      memberPubky,
      role: 'member',
      addedAt: ts,
      removedAt: null,
      status: 'active',
    };
    await StorageService.upsertGroupMember(member);
    await fanOutMembershipOp(owner, channelId, 'add', memberPubky);
    notifyGroupEvent(owner, channelId);
    return member;
  },

  /**
   * Admin-only. Marks the member `removed`, bumps `membership_epoch`, and
   * stops including them in future fan-out. Pairwise fan-out means cutoff
   * is immediate — there is no shared secret to rotate.
   */
  async removeMember(channelId: string, memberPubky: PubkyKey): Promise<void> {
    const owner = requireOwner();
    await requireAdmin(owner, channelId);
    await requirePrivateChannel(owner, channelId);
    const existing = await StorageService.getGroupMember(owner, channelId, memberPubky);
    if (!existing || existing.status === 'removed') return;
    const ts = Date.now();
    await StorageService.upsertGroupMember({
      ...existing,
      status: 'removed',
      removedAt: ts,
    });
    await StorageService.bumpGroupMembershipEpoch(owner, channelId);
    await fanOutMembershipOp(owner, channelId, 'remove', memberPubky, [memberPubky]);
    notifyGroupEvent(owner, channelId);
  },

  async leaveChannel(channelId: string): Promise<void> {
    const owner = requireOwner();
    const channel = await StorageService.getGroupChannel(owner, channelId);
    if (!channel) throw new GroupServiceError('not-found', 'Channel not found');
    if (channel.isPublic) {
      const self = await StorageService.getGroupMember(owner, channelId, owner);
      if (self) {
        await StorageService.upsertGroupMember({
          ...self,
          status: 'removed',
          removedAt: Date.now(),
        });
      }
      notifyGroupEvent(owner, channelId);
      return;
    }
    await requireActiveMember(owner, channelId, owner);
    const self = await StorageService.getGroupMember(owner, channelId, owner);
    if (self) {
      await StorageService.upsertGroupMember({
        ...self,
        status: 'removed',
        removedAt: Date.now(),
      });
    }
    await StorageService.bumpGroupMembershipEpoch(owner, channelId);
    await fanOutMembershipOp(owner, channelId, 'leave', owner);
    notifyGroupEvent(owner, channelId);
  },

  // ── Public channels ───────────────────────────────────────────────────────

  async createPublicChannel(name: string): Promise<GroupChannel> {
    const owner = requireOwner();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new GroupServiceError('invalid-input', 'Channel name must not be empty');
    }
    const localId = uuidv4();
    const channelId = buildPublicChannelId(owner, localId);
    const ts = Date.now();
    const channel: GroupChannel = {
      ownerPubky: owner,
      channelId,
      name: trimmed,
      createdAt: ts,
      updatedAt: ts,
      createdBy: owner,
      isPublic: true,
      lastMessageAt: ts,
      membershipEpoch: 0,
    };
    await StorageService.upsertGroupChannel(channel);
    await StorageService.upsertGroupMember({
      ownerPubky: owner,
      channelId,
      memberPubky: owner,
      role: 'admin',
      addedAt: ts,
      removedAt: null,
      status: 'active',
    });
    const meta: PublicChannelMeta = {
      version: 1,
      channel_id: channelId,
      name: trimmed,
      created_by: owner,
      created_at: ts,
    };
    await PubkyService.put(publicChannelMetaUrl(owner, localId), JSON.stringify(meta));
    notifyGroupEvent(owner, channelId);
    return channel;
  },

  async joinPublicChannel(ref: string): Promise<GroupChannel> {
    const owner = requireOwner();
    const parsed = parsePublicChannelRef(ref);
    if (!parsed) {
      throw new GroupServiceError(
        'invalid-input',
        'Not a public channel id or hypercolor://join-public?channel=… link',
      );
    }
    const channelId = buildPublicChannelId(parsed.hostPubky, parsed.localId);
    const existing = await StorageService.getGroupChannel(owner, channelId);
    if (existing) {
      await refreshPublicChannel(owner, existing);
      return (await StorageService.getGroupChannel(owner, channelId)) ?? existing;
    }
    const rawMeta = await PubkyService.get(publicChannelMetaUrl(parsed.hostPubky, parsed.localId));
    if (!rawMeta) {
      throw new GroupServiceError('not-found', 'Public channel metadata was not found on the host');
    }
    const meta = decodePublicChannelMeta(rawMeta);
    if (!meta) {
      throw new GroupServiceError('invalid-input', 'Public channel metadata is malformed');
    }
    const ts = Date.now();
    const channel: GroupChannel = {
      ownerPubky: owner,
      channelId,
      name: meta.name,
      createdAt: meta.created_at,
      updatedAt: ts,
      createdBy: parsed.hostPubky,
      isPublic: true,
      lastMessageAt: null,
      membershipEpoch: 0,
    };
    await StorageService.upsertGroupChannel(channel);
    await StorageService.upsertGroupMember({
      ownerPubky: owner,
      channelId,
      memberPubky: parsed.hostPubky,
      role: 'admin',
      addedAt: meta.created_at,
      removedAt: null,
      status: 'active',
    });
    if (owner !== parsed.hostPubky) {
      await StorageService.upsertGroupMember({
        ownerPubky: owner,
        channelId,
        memberPubky: owner,
        role: 'member',
        addedAt: ts,
        removedAt: null,
        status: 'active',
      });
    }
    await refreshPublicChannel(owner, channel);
    notifyGroupEvent(owner, channelId);
    return (await StorageService.getGroupChannel(owner, channelId)) ?? channel;
  },

  async sendPublicMessage(
    channelId: string,
    body: string,
    replyTo?: { eventId: string; authorPubky: string },
  ): Promise<GroupMessage> {
    const owner = requireOwner();
    const channel = await StorageService.getGroupChannel(owner, channelId);
    if (!channel || !channel.isPublic) {
      throw new GroupServiceError('public-only', 'Not a public channel');
    }
    const parsed = parsePublicChannelId(channelId);
    if (!parsed) {
      throw new GroupServiceError('invalid-input', 'Public channel id is malformed');
    }
    const text = body.trim();
    if (text.length === 0) {
      throw new GroupServiceError('invalid-input', 'Message body must not be empty');
    }
    const eventId = uuidv4();
    const sentAt = Date.now();
    const doc: PublicChannelMessageDocument = {
      version: 1,
      kind: PUBLIC_CHANNEL_MESSAGE_KIND,
      channel_id: channelId,
      event_id: eventId,
      sent_at: sentAt,
      body: text,
      author: owner,
    };
    if (replyTo !== undefined) {
      doc.reply_to = replyTo.eventId;
      doc.reply_to_author = replyTo.authorPubky;
    }
    const json = JSON.stringify(doc);
    await PubkyService.put(
      publicChannelMessageUrl(owner, parsed.hostPubky, parsed.localId, sentAt, eventId),
      json,
    );
    const message: GroupMessage = {
      ownerPubky: owner,
      channelId,
      eventId,
      senderPubky: owner,
      kind: PUBLIC_CHANNEL_MESSAGE_KIND,
      body: text,
      rawJson: json,
      sentAt,
      receivedAt: null,
      deliveryState: 'sent',
      replyToEventId: replyTo?.eventId ?? null,
      replyToAuthorPubky: replyTo?.authorPubky ?? null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    };
    await StorageService.saveGroupMessage(message);
    await StorageService.upsertGroupMember({
      ownerPubky: owner,
      channelId,
      memberPubky: owner,
      role: owner === parsed.hostPubky ? 'admin' : 'member',
      addedAt: Date.now(),
      removedAt: null,
      status: 'active',
    });
    await StorageService.touchGroupChannel(owner, channelId, sentAt);
    notifyGroupEvent(owner, channelId);
    return message;
  },

  async refreshPublicChannel(channelId: string): Promise<void> {
    const owner = requireOwner();
    const channel = await StorageService.getGroupChannel(owner, channelId);
    if (!channel || !channel.isPublic) {
      throw new GroupServiceError('public-only', 'Not a public channel');
    }
    await refreshPublicChannel(owner, channel);
    notifyGroupEvent(owner, channelId);
  },

  publicInviteLink(channelId: string): string | null {
    const parsed = parsePublicChannelId(channelId);
    if (!parsed) return null;
    return buildPublicChannelInvite(parsed.hostPubky, parsed.localId);
  },

  /**
   * Fans out a caller-built PAM (e.g. `chat.attachment.v0`) to active
   * private-group members. Same persist/queue protocol as text messages.
   */
  async sendPreparedFanout(input: {
    channelId: string;
    kind: string;
    eventId: string;
    sentAt: number;
    body: string;
    rawJson: string;
  }): Promise<GroupMessage> {
    const owner = requireOwner();
    await requireActiveMember(owner, input.channelId, owner);
    const channel = await requirePrivateChannel(owner, input.channelId);
    const message = await fanOutEnvelope({
      ownerPubky: owner,
      channelId: input.channelId,
      senderPubky: owner,
      kind: input.kind,
      eventId: input.eventId,
      sentAt: input.sentAt,
      body: input.body,
      rawJson: input.rawJson,
      replyToEventId: null,
      targetEventId: null,
    });
    await StorageService.touchGroupChannel(owner, channel.channelId, input.sentAt);
    notifyGroupEvent(owner, input.channelId);
    return message;
  },
};

async function refreshPublicChannel(ownerPubky: PubkyKey, channel: GroupChannel): Promise<void> {
  const parsed = parsePublicChannelId(channel.channelId);
  if (!parsed) return;
  const authors = new Set<string>([parsed.hostPubky, ownerPubky]);
  const members = await StorageService.listGroupMembers(ownerPubky, channel.channelId, 'active');
  for (const member of members) authors.add(member.memberPubky);

  let latest: number | null = channel.lastMessageAt;
  for (const author of authors) {
    const listed = await PubkyService.list(
      publicChannelMessagesPrefix(author, parsed.hostPubky, parsed.localId),
    );
    if (!listed.ok) continue;
    for (const url of listed.urls) {
      const raw = await PubkyService.get(url);
      if (!raw) continue;
      const doc = decodePublicChannelMessage(raw, author);
      if (!doc) continue;
      if (doc.channel_id !== channel.channelId) continue;
      const inserted = await StorageService.saveGroupMessage({
        ownerPubky,
        channelId: channel.channelId,
        eventId: doc.event_id,
        senderPubky: doc.author,
        kind: PUBLIC_CHANNEL_MESSAGE_KIND,
        body: doc.body,
        rawJson: raw,
        sentAt: doc.sent_at,
        receivedAt: Date.now(),
        deliveryState: 'delivered',
        replyToEventId: doc.reply_to ?? null,
        replyToAuthorPubky: doc.reply_to_author ?? null,
        targetEventId: null,
        targetAuthorPubky: null,
        editedAt: null,
        deleted: false,
      });
      if (inserted) {
        await StorageService.upsertGroupMember({
          ownerPubky,
          channelId: channel.channelId,
          memberPubky: doc.author,
          role: doc.author === parsed.hostPubky ? 'admin' : 'member',
          addedAt: doc.sent_at,
          removedAt: null,
          status: 'active',
        });
      }
      if (latest === null || doc.sent_at > latest) latest = doc.sent_at;
    }
  }
  if (latest !== null) {
    await StorageService.touchGroupChannel(ownerPubky, channel.channelId, latest);
  }
}

async function fanOutMembershipOp(
  ownerPubky: PubkyKey,
  channelId: string,
  op: 'add' | 'remove' | 'leave',
  subjectPubky: PubkyKey,
  extraRecipients: PubkyKey[] = [],
): Promise<void> {
  const eventId = uuidv4();
  const sentAt = Date.now();
  const built = buildGroupMembershipEnvelope({
    channelId,
    eventId,
    sentAt,
    op,
    subjectPubky,
  });
  await fanOutEnvelope({
    ownerPubky,
    channelId,
    senderPubky: ownerPubky,
    kind: GROUP_MEMBERSHIP_KIND,
    eventId,
    sentAt,
    body: op,
    rawJson: built.json,
    replyToEventId: null,
    targetEventId: null,
    targetAuthorPubky: null,
    extraRecipients,
  });
}

async function fanOutEnvelope(input: {
  ownerPubky: PubkyKey;
  channelId: string;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
  sentAt: number;
  body: string;
  rawJson: string;
  replyToEventId: string | null;
  replyToAuthorPubky?: string | null;
  targetEventId: string | null;
  targetAuthorPubky?: string | null;
  extraRecipients?: PubkyKey[];
}): Promise<GroupMessage> {
  const recipients = uniquePubkys([
    ...(await activeFanoutRecipients(input.ownerPubky, input.channelId)),
    ...(input.extraRecipients ?? []),
  ]).filter(pubky => pubky !== input.ownerPubky);
  const ts = Date.now();
  const message: GroupMessage = {
    ownerPubky: input.ownerPubky,
    channelId: input.channelId,
    eventId: input.eventId,
    senderPubky: input.senderPubky,
    kind: input.kind,
    body: input.body,
    rawJson: input.rawJson,
    sentAt: input.sentAt,
    receivedAt: null,
    deliveryState: recipients.length === 0 ? 'sent' : 'sending',
    replyToEventId: input.replyToEventId,
    replyToAuthorPubky: input.replyToAuthorPubky ?? null,
    targetEventId: input.targetEventId,
    targetAuthorPubky: input.targetAuthorPubky ?? null,
    editedAt: null,
    deleted: false,
  };
  const queueItems: DeliveryQueueItem[] = recipients.map(peerPubky => ({
    id: uuidv4(),
    messageId: input.eventId,
    recipientPubky: peerPubky,
    payload: JSON.stringify({
      type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
      ownerPubky: input.ownerPubky,
      peerPubky,
      senderPubky: input.senderPubky,
      kind: input.kind,
      eventId: input.eventId,
      channelId: input.channelId,
      rawJson: input.rawJson,
    }),
    attempts: 0,
    nextRetryAt: ts,
    createdAt: ts,
  }));
  await StorageService.persistGroupSendIntent({ message, queueItems });

  for (let i = 0; i < recipients.length; i += 1) {
    const peerPubky = recipients[i]!;
    const queueItem = queueItems[i]!;
    try {
      await LinkService.sendPersistedLinkJson({
        ownerPubky: input.ownerPubky,
        senderPubky: input.senderPubky,
        peerPubky,
        queueId: queueItem.id,
        kind: input.kind,
        eventId: input.eventId,
        rawJson: input.rawJson,
        channelId: input.channelId,
      });
    } catch {
      // Queue item stays; other members are still sent.
    }
  }

  const remaining = await StorageService.countDeliveryQueueForMessage(input.eventId);
  let nextState: GroupMessage['deliveryState'] = 'sending';
  if (remaining === 0) {
    const outcomes = await StorageService.getGroupFanoutAggregate(
      input.ownerPubky,
      input.channelId,
      input.senderPubky,
      input.eventId,
    );
    nextState = groupDeliveryFromOutcomes(outcomes);
    await StorageService.updateGroupMessageDeliveryState(
      input.ownerPubky,
      input.channelId,
      input.senderPubky,
      input.eventId,
      nextState,
    );
  }
  return { ...message, deliveryState: nextState };
}

async function activeFanoutRecipients(
  ownerPubky: PubkyKey,
  channelId: string,
): Promise<PubkyKey[]> {
  const members = await StorageService.listGroupMembers(ownerPubky, channelId, 'active');
  return members.map(m => m.memberPubky).filter(pubky => pubky !== ownerPubky);
}

async function requirePrivateChannel(
  ownerPubky: PubkyKey,
  channelId: string,
): Promise<GroupChannel> {
  const channel = await StorageService.getGroupChannel(ownerPubky, channelId);
  if (!channel) throw new GroupServiceError('not-found', 'Channel not found');
  if (channel.isPublic) {
    throw new GroupServiceError('private-only', 'Use the public-channel publish path');
  }
  return channel;
}

async function requireActiveMember(
  ownerPubky: PubkyKey,
  channelId: string,
  memberPubky: PubkyKey,
): Promise<GroupMember> {
  const member = await StorageService.getGroupMember(ownerPubky, channelId, memberPubky);
  if (!member || member.status !== 'active') {
    throw new GroupServiceError('not-member', 'Not an active member of this channel');
  }
  return member;
}

async function requireAdmin(ownerPubky: PubkyKey, channelId: string): Promise<GroupMember> {
  const member = await requireActiveMember(ownerPubky, channelId, ownerPubky);
  if (member.role !== 'admin') {
    throw new GroupServiceError('not-admin', 'Only a channel admin can change membership');
  }
  return member;
}

function requireOwner(): PubkyKey {
  const owner = KeyStore.getPubky();
  if (!owner) throw new GroupServiceError('invalid-input', 'No local pubky');
  return owner;
}

function uniquePubkys(values: PubkyKey[]): PubkyKey[] {
  const seen = new Set<string>();
  const out: PubkyKey[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
