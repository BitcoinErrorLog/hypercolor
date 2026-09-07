import { StorageService } from '../StorageService';
import type { PubkyKey } from '../../types';
import {
  GROUP_DELETE_KIND,
  GROUP_EDIT_KIND,
  GROUP_MEMBERSHIP_KIND,
  GROUP_MESSAGE_KIND,
  GROUP_REACTION_KIND,
  groupMessageBody,
  groupReplyToAuthorPubky,
  groupReplyToEventId,
  groupTargetAuthorPubky,
  groupTargetEventId,
  parsePrivateChannelId,
  type GroupChannel,
  type GroupDeferredEvent,
  type GroupEnvelope,
  type GroupMember,
  type GroupMessage,
  type GroupPeerTrust,
} from '../../types/group';
import { CHAT_TAG_KIND } from '../../types/link';
import { applyDeferredChatTag } from '../link/applyChatKinds';
import { notifyGroupEvent } from './groupEvents';
import { isGroupInboundGated } from './groupInboundGate';

/**
 * Applies one already-decoded group PAM. LinkService calls this after
 * stream-item persist. Dedup key is `(owner, channel_id, sender_pubky, event_id)`.
 *
 * Authorize first; persist to `group_messages` only if authorized.
 * Trust checks are documented on `src/types/group.ts`.
 *
 * `peerTrust` is mandatory so a future caller cannot reintroduce the
 * pending-peer create bug by invoking this funnel with no accept-gate
 * check. Pass `'accepted'` only when the recipient has said yes to this
 * Encrypted-Link peer (or the caller is a test/live-proof that is
 * deliberately exercising membership auth, not DM trust). When the value
 * is `'gated'`, ops {@link isGroupInboundGated} reserves for an accepted
 * peer are skipped here — fail-closed. LinkService still has to leave the
 * carrying `link_stream_items` row unprocessed so accept can replay them.
 */
export async function applyGroupInbound(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  envelope: GroupEnvelope;
  rawJson: string;
  receivedAt: number;
  peerTrust: GroupPeerTrust;
}): Promise<void> {
  const { ownerPubky, senderPubky, envelope, rawJson, receivedAt, peerTrust } = input;
  if (await isGroupInboundGated({ ownerPubky, envelope, peerTrust })) return;
  const channelId = envelope.channel_id;

  if (await StorageService.hasGroupEvent(ownerPubky, channelId, senderPubky, envelope.event_id)) {
    return;
  }

  const decision = await authorizeInbound(ownerPubky, senderPubky, envelope);
  if (decision === 'reject') {
    await StorageService.markGroupEventSeen(
      ownerPubky,
      channelId,
      senderPubky,
      envelope.event_id,
      receivedAt,
    );
    return;
  }

  if (isTargetedKind(envelope)) {
    const handled = await applyTargetedIfReady(
      ownerPubky,
      senderPubky,
      envelope,
      rawJson,
      receivedAt,
    );
    if (handled === 'deferred' || handled === 'rejected') {
      if (handled === 'rejected') {
        await StorageService.markGroupEventSeen(
          ownerPubky,
          channelId,
          senderPubky,
          envelope.event_id,
          receivedAt,
        );
      }
      return;
    }
  } else if (envelope.kind === GROUP_MEMBERSHIP_KIND) {
    const applied = await applyMembership(ownerPubky, senderPubky, envelope);
    if (!applied) {
      await StorageService.markGroupEventSeen(
        ownerPubky,
        channelId,
        senderPubky,
        envelope.event_id,
        receivedAt,
      );
      return;
    }
    await persistAdmitted(ownerPubky, senderPubky, envelope, rawJson, receivedAt);
  } else if (envelope.kind === GROUP_MESSAGE_KIND) {
    await persistAdmitted(ownerPubky, senderPubky, envelope, rawJson, receivedAt);
    await StorageService.touchGroupChannel(ownerPubky, channelId, envelope.sent_at);
    await applyDeferredForTarget(ownerPubky, channelId, senderPubky, envelope.event_id);
  }

  notifyGroupEvent(ownerPubky, channelId);
}

type AuthDecision = 'accept' | 'reject';

async function authorizeInbound(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: GroupEnvelope,
): Promise<AuthDecision> {
  if (envelope.kind === GROUP_MEMBERSHIP_KIND) {
    return authorizeMembership(ownerPubky, senderPubky, envelope);
  }

  const channel = await StorageService.getGroupChannel(ownerPubky, envelope.channel_id);
  if (!channel || channel.isPublic) return 'reject';
  const senderMember = await StorageService.getGroupMember(
    ownerPubky,
    envelope.channel_id,
    senderPubky,
  );
  if (senderMember?.status !== 'active') return 'reject';

  if (envelope.kind === GROUP_EDIT_KIND || envelope.kind === GROUP_DELETE_KIND) {
    if (envelope.target_author_pubky !== senderPubky) return 'reject';
  }
  return 'accept';
}

async function authorizeMembership(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: Extract<GroupEnvelope, { kind: typeof GROUP_MEMBERSHIP_KIND }>,
): Promise<AuthDecision> {
  const channel = await StorageService.getGroupChannel(ownerPubky, envelope.channel_id);

  if (envelope.op === 'create') {
    const bound = parsePrivateChannelId(envelope.channel_id);
    if (!bound || bound.founderPubky !== senderPubky) return 'reject';
    if (!channel) return 'accept';
    if (channel.isPublic) return 'reject';
    if (channel.createdBy !== senderPubky) return 'reject';
    const senderMember = await StorageService.getGroupMember(
      ownerPubky,
      envelope.channel_id,
      senderPubky,
    );
    if (senderMember?.status === 'active' && senderMember.role === 'admin') return 'accept';
    return 'reject';
  }

  if (!channel || channel.isPublic) return 'reject';

  if (envelope.op === 'leave') {
    if (envelope.subject_pubky !== undefined && envelope.subject_pubky !== senderPubky) {
      return 'reject';
    }
    return 'accept';
  }

  const senderMember = await StorageService.getGroupMember(
    ownerPubky,
    envelope.channel_id,
    senderPubky,
  );
  if (senderMember?.status === 'active' && senderMember.role === 'admin') return 'accept';
  return 'reject';
}

async function applyMembership(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: Extract<GroupEnvelope, { kind: typeof GROUP_MEMBERSHIP_KIND }>,
): Promise<boolean> {
  const channelId = envelope.channel_id;

  if (envelope.op === 'create') {
    const channel = await StorageService.getGroupChannel(ownerPubky, channelId);
    if (channel) {
      if (envelope.name && envelope.name.trim().length > 0) {
        await StorageService.updateGroupChannelName(ownerPubky, channelId, envelope.name.trim());
      }
      return true;
    }

    const name = envelope.name?.trim() || 'Group';
    const createdAt = envelope.sent_at;
    const roster = new Set<string>(envelope.members ?? []);
    roster.add(senderPubky);
    roster.add(ownerPubky);
    const members: GroupMember[] = [...roster].map(memberPubky => ({
      ownerPubky,
      channelId,
      memberPubky,
      role: memberPubky === senderPubky ? 'admin' : 'member',
      addedAt: createdAt,
      removedAt: null,
      status: 'active',
    }));
    const draft: GroupChannel = {
      ownerPubky,
      channelId,
      name,
      createdAt,
      updatedAt: createdAt,
      createdBy: senderPubky,
      isPublic: false,
      lastMessageAt: createdAt,
      membershipEpoch: 0,
    };
    const outcome = await StorageService.insertInboundPrivateCreate({ channel: draft, members });
    if (outcome === 'founder-mismatch') return false;
    if (outcome === 'exists') {
      const existing = await StorageService.getGroupChannel(ownerPubky, channelId);
      if (!existing || existing.createdBy !== senderPubky) return false;
      if (envelope.name && envelope.name.trim().length > 0) {
        await StorageService.updateGroupChannelName(ownerPubky, channelId, envelope.name.trim());
      }
    }
    return true;
  }

  if (envelope.op === 'leave') {
    await markRemoved(ownerPubky, channelId, senderPubky, envelope.sent_at);
    return true;
  }

  if (envelope.op === 'add') {
    const subject = envelope.subject_pubky;
    if (!subject) return false;
    await upsertActiveMember(ownerPubky, channelId, subject, 'member', envelope.sent_at);
    return true;
  }

  if (envelope.op === 'remove') {
    const subject = envelope.subject_pubky;
    if (!subject) return false;
    await markRemoved(ownerPubky, channelId, subject, envelope.sent_at);
    return true;
  }

  return false;
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

function isTargetedKind(
  envelope: GroupEnvelope,
): envelope is Extract<
  GroupEnvelope,
  { kind: typeof GROUP_REACTION_KIND | typeof GROUP_EDIT_KIND | typeof GROUP_DELETE_KIND }
> {
  return (
    envelope.kind === GROUP_REACTION_KIND ||
    envelope.kind === GROUP_EDIT_KIND ||
    envelope.kind === GROUP_DELETE_KIND
  );
}

async function applyTargetedIfReady(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: Extract<
    GroupEnvelope,
    { kind: typeof GROUP_REACTION_KIND | typeof GROUP_EDIT_KIND | typeof GROUP_DELETE_KIND }
  >,
  rawJson: string,
  receivedAt: number,
): Promise<'applied' | 'deferred' | 'rejected'> {
  const target = await StorageService.getGroupMessage(
    ownerPubky,
    envelope.channel_id,
    envelope.target_author_pubky,
    envelope.target_event_id,
  );
  if (!target) {
    const foreign = await StorageService.findGroupMessageByAuthorEvent(
      ownerPubky,
      envelope.target_author_pubky,
      envelope.target_event_id,
    );
    if (foreign && foreign.channelId !== envelope.channel_id) {
      return 'rejected';
    }
    await StorageService.saveGroupDeferred({
      ownerPubky,
      channelId: envelope.channel_id,
      senderPubky,
      eventId: envelope.event_id,
      kind: envelope.kind,
      body: groupMessageBody(envelope),
      rawJson,
      sentAt: envelope.sent_at,
      receivedAt,
      targetEventId: envelope.target_event_id,
      targetAuthorPubky: envelope.target_author_pubky,
    });
    return 'deferred';
  }

  if (
    (envelope.kind === GROUP_EDIT_KIND || envelope.kind === GROUP_DELETE_KIND) &&
    (target.senderPubky !== senderPubky || target.channelId !== envelope.channel_id)
  ) {
    return 'rejected';
  }

  await persistAdmitted(ownerPubky, senderPubky, envelope, rawJson, receivedAt);
  if (envelope.kind === GROUP_EDIT_KIND) {
    await StorageService.applyGroupMessageEdit(
      ownerPubky,
      envelope.channel_id,
      envelope.target_author_pubky,
      envelope.target_event_id,
      envelope.body,
      envelope.sent_at,
    );
  } else if (envelope.kind === GROUP_DELETE_KIND) {
    await StorageService.tombstoneGroupMessage(
      ownerPubky,
      envelope.channel_id,
      envelope.target_author_pubky,
      envelope.target_event_id,
    );
  }
  return 'applied';
}

async function applyDeferredForTarget(
  ownerPubky: PubkyKey,
  channelId: string,
  targetAuthorPubky: PubkyKey,
  targetEventId: string,
): Promise<void> {
  const target = await StorageService.getGroupMessage(
    ownerPubky,
    channelId,
    targetAuthorPubky,
    targetEventId,
  );
  if (!target) return;
  const pending = await StorageService.listGroupDeferredForTarget(
    ownerPubky,
    channelId,
    targetAuthorPubky,
    targetEventId,
  );
  for (const ev of pending) {
    if (ev.kind === GROUP_EDIT_KIND || ev.kind === GROUP_DELETE_KIND) {
      if (ev.senderPubky !== target.senderPubky || ev.targetAuthorPubky !== target.senderPubky) {
        await StorageService.deleteGroupDeferred(ownerPubky, channelId, ev.senderPubky, ev.eventId);
        await StorageService.markGroupEventSeen(
          ownerPubky,
          channelId,
          ev.senderPubky,
          ev.eventId,
          ev.receivedAt,
        );
        continue;
      }
    }
    if (ev.kind === CHAT_TAG_KIND) {
      await applyDeferredChatTag({
        ownerPubky,
        senderPubky: ev.senderPubky,
        rawJson: ev.rawJson,
      });
      await StorageService.deleteGroupDeferred(ownerPubky, channelId, ev.senderPubky, ev.eventId);
      continue;
    }
    await persistDeferredAsHistory(ev);
    if (ev.kind === GROUP_EDIT_KIND) {
      await StorageService.applyGroupMessageEdit(
        ownerPubky,
        channelId,
        targetAuthorPubky,
        targetEventId,
        ev.body,
        ev.sentAt,
      );
    } else if (ev.kind === GROUP_DELETE_KIND) {
      await StorageService.tombstoneGroupMessage(
        ownerPubky,
        channelId,
        targetAuthorPubky,
        targetEventId,
      );
    }
    await StorageService.deleteGroupDeferred(ownerPubky, channelId, ev.senderPubky, ev.eventId);
  }
}

async function persistDeferredAsHistory(ev: GroupDeferredEvent): Promise<void> {
  await StorageService.saveGroupMessage({
    ownerPubky: ev.ownerPubky,
    channelId: ev.channelId,
    eventId: ev.eventId,
    senderPubky: ev.senderPubky,
    kind: ev.kind,
    body: ev.body,
    rawJson: ev.rawJson,
    sentAt: ev.sentAt,
    receivedAt: ev.receivedAt,
    deliveryState: 'delivered',
    replyToEventId: null,
    replyToAuthorPubky: null,
    targetEventId: ev.targetEventId,
    targetAuthorPubky: ev.targetAuthorPubky,
    editedAt: null,
    deleted: false,
  });
}

async function persistAdmitted(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: GroupEnvelope,
  rawJson: string,
  receivedAt: number,
): Promise<void> {
  const row: GroupMessage = {
    ownerPubky,
    channelId: envelope.channel_id,
    eventId: envelope.event_id,
    senderPubky,
    kind: envelope.kind,
    body: groupMessageBody(envelope),
    rawJson,
    sentAt: envelope.sent_at,
    receivedAt,
    deliveryState: 'delivered',
    replyToEventId: groupReplyToEventId(envelope),
    replyToAuthorPubky: groupReplyToAuthorPubky(envelope),
    targetEventId: groupTargetEventId(envelope),
    targetAuthorPubky: groupTargetAuthorPubky(envelope),
    editedAt: null,
    deleted: false,
  };
  await StorageService.saveGroupMessage(row);
}
