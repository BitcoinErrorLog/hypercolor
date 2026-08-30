import { StorageService } from '../StorageService';
import type { PubkyKey } from '../../types';
import {
  GROUP_DELETE_KIND,
  GROUP_EDIT_KIND,
  GROUP_MEMBERSHIP_KIND,
  GROUP_MESSAGE_KIND,
  groupMessageBody,
  groupReplyToEventId,
  groupTargetEventId,
  type GroupEnvelope,
  type GroupMember,
  type GroupMessage,
} from '../../types/group';
import { notifyGroupEvent } from './groupEvents';

/**
 * Applies one already-decoded group PAM. LinkService calls this after
 * stream-item persist. Dedup key is `(owner, channel_id, event_id)`.
 *
 * Trust checks are documented on `src/types/group.ts`.
 */
export async function applyGroupInbound(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  envelope: GroupEnvelope;
  rawJson: string;
  receivedAt: number;
}): Promise<void> {
  const { ownerPubky, senderPubky, envelope, rawJson, receivedAt } = input;
  const channelId = envelope.channel_id;
  if (await StorageService.hasGroupMessage(ownerPubky, channelId, envelope.event_id)) {
    return;
  }

  const row: GroupMessage = {
    ownerPubky,
    channelId,
    eventId: envelope.event_id,
    senderPubky,
    kind: envelope.kind,
    body: groupMessageBody(envelope),
    rawJson,
    sentAt: envelope.sent_at,
    receivedAt,
    deliveryState: 'delivered',
    replyToEventId: groupReplyToEventId(envelope),
    targetEventId: groupTargetEventId(envelope),
    editedAt: null,
    deleted: false,
  };
  await StorageService.saveGroupMessage(row);

  if (envelope.kind === GROUP_MEMBERSHIP_KIND) {
    await applyMembership(ownerPubky, senderPubky, envelope);
  } else if (envelope.kind === GROUP_EDIT_KIND || envelope.kind === GROUP_DELETE_KIND) {
    await applyMutationIfReady(ownerPubky, senderPubky, envelope);
  } else if (envelope.kind === GROUP_MESSAGE_KIND) {
    await StorageService.touchGroupChannel(ownerPubky, channelId, envelope.sent_at);
    await applyDeferredMutations(ownerPubky, channelId, envelope.event_id);
  }

  notifyGroupEvent(ownerPubky, channelId);
}

async function applyMembership(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: Extract<GroupEnvelope, { kind: typeof GROUP_MEMBERSHIP_KIND }>,
): Promise<void> {
  const channelId = envelope.channel_id;
  const channel = await StorageService.getGroupChannel(ownerPubky, channelId);
  const senderMember = await StorageService.getGroupMember(ownerPubky, channelId, senderPubky);
  const senderIsAdmin = senderMember?.status === 'active' && senderMember.role === 'admin';

  if (envelope.op === 'create') {
    if (!channel) {
      const name = envelope.name?.trim() || 'Group';
      const createdAt = envelope.sent_at;
      await StorageService.upsertGroupChannel({
        ownerPubky,
        channelId,
        name,
        createdAt,
        updatedAt: createdAt,
        createdBy: senderPubky,
        isPublic: false,
        lastMessageAt: createdAt,
        membershipEpoch: 0,
      });
      const roster = new Set<string>(envelope.members ?? []);
      roster.add(senderPubky);
      roster.add(ownerPubky);
      for (const memberPubky of roster) {
        const role = memberPubky === senderPubky ? 'admin' : 'member';
        await upsertActiveMember(ownerPubky, channelId, memberPubky, role, createdAt);
      }
      return;
    }
    if (!senderIsAdmin) return;
    if (envelope.name && envelope.name.trim().length > 0) {
      await StorageService.upsertGroupChannel({
        ...channel,
        name: envelope.name.trim(),
        updatedAt: Date.now(),
      });
    }
    return;
  }

  if (envelope.op === 'leave') {
    if (envelope.subject_pubky !== undefined && envelope.subject_pubky !== senderPubky) {
      return;
    }
    await markRemoved(ownerPubky, channelId, senderPubky, envelope.sent_at);
    return;
  }

  if (!senderIsAdmin) return;

  if (envelope.op === 'add') {
    const subject = envelope.subject_pubky;
    if (!subject) return;
    const existing = await StorageService.getGroupChannel(ownerPubky, channelId);
    if (!existing) return;
    await upsertActiveMember(ownerPubky, channelId, subject, 'member', envelope.sent_at);
    return;
  }

  if (envelope.op === 'remove') {
    const subject = envelope.subject_pubky;
    if (!subject) return;
    const existing = await StorageService.getGroupChannel(ownerPubky, channelId);
    if (!existing) return;
    await markRemoved(ownerPubky, channelId, subject, envelope.sent_at);
  }
}

async function upsertActiveMember(
  ownerPubky: PubkyKey,
  channelId: string,
  memberPubky: PubkyKey,
  role: GroupMember['role'],
  addedAt: number,
): Promise<void> {
  const existing = await StorageService.getGroupMember(ownerPubky, channelId, memberPubky);
  await StorageService.upsertGroupMember({
    ownerPubky,
    channelId,
    memberPubky,
    role: existing?.role === 'admin' ? 'admin' : role,
    addedAt: existing?.status === 'active' ? existing.addedAt : addedAt,
    removedAt: null,
    status: 'active',
  });
}

async function markRemoved(
  ownerPubky: PubkyKey,
  channelId: string,
  memberPubky: PubkyKey,
  removedAt: number,
): Promise<void> {
  const existing = await StorageService.getGroupMember(ownerPubky, channelId, memberPubky);
  if (!existing) {
    await StorageService.upsertGroupMember({
      ownerPubky,
      channelId,
      memberPubky,
      role: 'member',
      addedAt: removedAt,
      removedAt,
      status: 'removed',
    });
  } else if (existing.status !== 'removed') {
    await StorageService.upsertGroupMember({
      ...existing,
      removedAt,
      status: 'removed',
    });
  }
  await StorageService.bumpGroupMembershipEpoch(ownerPubky, channelId);
}

async function applyMutationIfReady(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: Extract<GroupEnvelope, { kind: typeof GROUP_EDIT_KIND | typeof GROUP_DELETE_KIND }>,
): Promise<void> {
  const target = await StorageService.getGroupMessage(
    ownerPubky,
    envelope.channel_id,
    envelope.target_event_id,
  );
  if (!target) return;
  if (target.senderPubky !== senderPubky) return;
  if (envelope.kind === GROUP_EDIT_KIND) {
    await StorageService.applyGroupMessageEdit(
      ownerPubky,
      envelope.channel_id,
      envelope.target_event_id,
      envelope.body,
      envelope.sent_at,
    );
    return;
  }
  await StorageService.tombstoneGroupMessage(
    ownerPubky,
    envelope.channel_id,
    envelope.target_event_id,
  );
}

async function applyDeferredMutations(
  ownerPubky: PubkyKey,
  channelId: string,
  targetEventId: string,
): Promise<void> {
  const target = await StorageService.getGroupMessage(ownerPubky, channelId, targetEventId);
  if (!target) return;
  const pending = await StorageService.listGroupMessagesForTarget(
    ownerPubky,
    channelId,
    targetEventId,
  );
  for (const ev of pending) {
    if (ev.kind !== GROUP_EDIT_KIND && ev.kind !== GROUP_DELETE_KIND) continue;
    if (ev.senderPubky !== target.senderPubky) continue;
    if (ev.kind === GROUP_EDIT_KIND) {
      await StorageService.applyGroupMessageEdit(
        ownerPubky,
        channelId,
        targetEventId,
        ev.body,
        ev.sentAt,
      );
    } else {
      await StorageService.tombstoneGroupMessage(ownerPubky, channelId, targetEventId);
    }
  }
}
