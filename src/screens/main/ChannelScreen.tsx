import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  ScrollView,
  BackHandler,
  AccessibilityInfo,
  findNodeHandle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Contact, RootStackParamList } from '../../types';
import type { GroupChannel, GroupMember, GroupMessage } from '../../types/group';
import {
  GROUP_REACTION_KIND,
  GROUP_MEMBERSHIP_KIND,
  groupReadCursorId,
  isGroupTimelineVisible,
} from '../../types/group';
import { CHAT_ATTACHMENT_KIND, type AttachmentRecord } from '../../types/attachment';
import { PRIVATE_GROUP_MEMBER_CAP } from '../../flags/config';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { GroupService, subscribeGroupEvents } from '../../services/group/GroupService';
import { LinkService } from '../../services/link/LinkService';
import { AttachmentBubble } from '../../components/AttachmentBubble';
import {
  pickAndSendFile,
  pickAndSendPhoto,
  type ComposerAttachNotice,
} from '../../components/ComposerAttachButton';
import { ComposerActionMenu } from '../../components/ComposerActionMenu';
import { formatDeliveryState } from '../../ui/messageStatus';
import { HIT_SLOP_44, minHitStyle } from '../../ui/hitTarget';
import { peerIdentity } from '../../ui/peerIdentity';
import { COPY, messageByteCountLabel, publicGraphWarning } from '../../copy/uxCopy';
import { sanitizeError } from '../../ui/sanitizedError';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import {
  composerActionItems,
  draftEnvelopeByteSize,
  draftExceedsByteCap,
  type DraftEnvelopeContext,
} from '../../ui/composerActions';
import { LINK_MESSAGE_MAX_BYTES } from '../../types/link';

type Props = NativeStackScreenProps<RootStackParamList, 'ChannelScreen'>;

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👎'];

function alertSanitized(err: unknown, fallback: string): void {
  const sanitized = sanitizeError(err, fallback);
  Alert.alert(sanitized.message);
}

export default function ChannelScreen({ route }: Props) {
  const { channelId } = route.params;
  const nav = useNavigation();
  const localPubky = useAuthStore(s => s.pubky);
  const ownerPubky = useAuthStore(s => s.pubky);
  const [channel, setChannel] = useState<GroupChannel | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showMembers, setShowMembers] = useState(false);
  const [addPubky, setAddPubky] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [composerNotice, setComposerNotice] = useState<ComposerAttachNotice | null>(null);

  const reload = useCallback(async () => {
    const [ch, msgs, mems, atts] = await Promise.all([
      GroupService.getChannel(channelId),
      GroupService.listMessages(channelId),
      GroupService.listMembers(channelId),
      ownerPubky
        ? StorageService.listAttachmentsForChannel(ownerPubky, channelId)
        : Promise.resolve([] as AttachmentRecord[]),
    ]);
    setChannel(ch);
    setMessages(msgs);
    setMembers(mems);
    setAttachments(atts);
    if (ownerPubky) {
      setContacts(await StorageService.getAllContacts(ownerPubky));
    }
    setLoading(false);
    if (ownerPubky) {
      const latest = msgs.reduce((max, m) => Math.max(max, m.sentAt), 0);
      await StorageService.setLinkReadCursor(
        ownerPubky,
        groupReadCursorId(channelId),
        latest > 0 ? latest : Date.now(),
      );
      const unread = await StorageService.countUnreadGroupMessages(ownerPubky);
      useSessionStatusStore.getState().setGroupUnreadCount(unread);
    }
  }, [channelId, ownerPubky]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!ownerPubky) return;
    return subscribeGroupEvents((owner, id) => {
      if (owner === ownerPubky && id === channelId) void reload();
    });
  }, [ownerPubky, channelId, reload]);

  const isAdmin = members.some(
    m => m.memberPubky === localPubky && m.status === 'active' && m.role === 'admin',
  );
  const selfActive = members.some(m => m.memberPubky === localPubky && m.status === 'active');

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !channel) return;
    const envelopeCtx: DraftEnvelopeContext = {
      surface: channel.isPublic ? 'public-topic' : 'private-group',
      channelId: channel.channelId,
    };
    if (localPubky) envelopeCtx.authorPubky = localPubky;
    if (replyTo?.eventId) envelopeCtx.replyToEventId = replyTo.eventId;
    if (replyTo?.senderPubky) envelopeCtx.replyToAuthorPubky = replyTo.senderPubky;
    if (draftExceedsByteCap(text, envelopeCtx)) return;
    const reply = replyTo;
    const editId = editingEventId;
    setSending(true);
    try {
      const replyTarget = reply
        ? { eventId: reply.eventId, authorPubky: reply.senderPubky }
        : undefined;
      if (editId) {
        await GroupService.editMessage(channelId, editId, text);
      } else if (channel.isPublic) {
        if (replyTarget) {
          await GroupService.sendPublicMessage(channelId, text, replyTarget);
        } else {
          await GroupService.sendPublicMessage(channelId, text);
        }
      } else if (replyTarget) {
        await GroupService.sendGroupMessage(channelId, text, replyTarget);
      } else {
        await GroupService.sendGroupMessage(channelId, text);
      }
      setDraft('');
      setReplyTo(null);
      setEditingEventId(null);
      await reload();
    } catch (err) {
      alertSanitized(err, COPY.couldNotSendMessage);
    } finally {
      setSending(false);
    }
  }, [draft, sending, channel, channelId, replyTo, editingEventId, localPubky, reload]);

  return (
    <ChannelScreenContent
      channel={channel}
      messages={messages}
      attachments={attachments}
      members={members}
      contacts={contacts}
      localPubky={localPubky}
      draft={draft}
      replyTo={replyTo}
      sending={sending}
      loading={loading}
      showMembers={showMembers}
      addPubky={addPubky}
      isAdmin={isAdmin}
      selfActive={selfActive}
      memberCap={PRIVATE_GROUP_MEMBER_CAP}
      onBack={() => nav.goBack()}
      onChangeDraft={setDraft}
      onSend={() => {
        void handleSend();
      }}
      actionMenuOpen={actionMenuOpen}
      composerNotice={composerNotice}
      onOpenActionMenu={() => setActionMenuOpen(true)}
      onCloseActionMenu={() => setActionMenuOpen(false)}
      onComposerAction={id => {
        setActionMenuOpen(false);
        if (!channel) return;
        if (id === 'photo') {
          void pickAndSendPhoto({ type: 'channel', channelId: channel.channelId }).then(result => {
            if (result.ok) void reload();
            else if ('notice' in result) setComposerNotice(result.notice);
          });
          return;
        }
        if (id === 'file') {
          void pickAndSendFile({ type: 'channel', channelId: channel.channelId }).then(result => {
            if (result.ok) void reload();
            else if ('notice' in result) setComposerNotice(result.notice);
          });
        }
      }}
      onReply={setReplyTo}
      onClearReply={() => setReplyTo(null)}
      onToggleMembers={() => setShowMembers(v => !v)}
      onChangeAddPubky={setAddPubky}
      onReact={async (eventId, authorPubky, emoji) => {
        try {
          await GroupService.reactToMessage(channelId, eventId, emoji, authorPubky);
          await reload();
        } catch (err) {
          alertSanitized(err, COPY.couldNotReact);
        }
      }}
      onEdit={eventId => {
        const target = messages.find(m => m.eventId === eventId);
        if (!target || target.deleted) return;
        setEditingEventId(eventId);
        setDraft(target.body);
        setReplyTo(null);
      }}
      onDelete={async eventId => {
        try {
          await GroupService.deleteMessage(channelId, eventId);
          await reload();
        } catch (err) {
          alertSanitized(err, COPY.couldNotDeleteMessage);
        }
      }}
      onAddMember={async () => {
        const pubky = addPubky.trim();
        if (!pubky) return;
        try {
          await GroupService.addMember(channelId, pubky);
          setAddPubky('');
          await reload();
        } catch (err) {
          alertSanitized(err, COPY.couldNotAddMember);
        }
      }}
      onRemoveMember={async pubky => {
        try {
          await GroupService.removeMember(channelId, pubky);
          await reload();
        } catch (err) {
          alertSanitized(err, COPY.couldNotRemoveMember);
        }
      }}
      onLeave={async () => {
        try {
          await GroupService.leaveChannel(channelId);
          nav.goBack();
        } catch (err) {
          alertSanitized(err, COPY.couldNotLeaveChannel);
        }
      }}
      onRefreshPublic={async () => {
        try {
          await GroupService.refreshPublicChannel(channelId);
          await reload();
        } catch (err) {
          alertSanitized(err, COPY.couldNotRefreshChannel);
        }
      }}
      onRetryFailed={() => {
        void (async () => {
          try {
            await LinkService.recoverPendingSends();
            await LinkService.drainRetries();
          } catch {
            // Bubble stays Failed until a drain succeeds.
          }
          await reload();
        })();
      }}
    />
  );
}

export function ChannelScreenContent({
  channel,
  messages,
  attachments,
  members,
  contacts,
  localPubky,
  draft,
  replyTo,
  sending,
  loading,
  showMembers,
  addPubky,
  isAdmin,
  selfActive,
  memberCap,
  onBack,
  onChangeDraft,
  onSend,
  actionMenuOpen,
  composerNotice,
  onOpenActionMenu,
  onCloseActionMenu,
  onComposerAction,
  onReply,
  onClearReply,
  onToggleMembers,
  onChangeAddPubky,
  onReact,
  onEdit,
  onDelete,
  onAddMember,
  onRemoveMember,
  onLeave,
  onRefreshPublic,
  onRetryFailed,
}: {
  channel: GroupChannel | null;
  messages: GroupMessage[];
  attachments: AttachmentRecord[];
  members: GroupMember[];
  contacts: Contact[];
  localPubky: string | null;
  draft: string;
  replyTo: GroupMessage | null;
  sending: boolean;
  loading: boolean;
  showMembers: boolean;
  addPubky: string;
  isAdmin: boolean;
  selfActive: boolean;
  memberCap: number;
  onBack: () => void;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  actionMenuOpen: boolean;
  composerNotice: ComposerAttachNotice | null;
  onOpenActionMenu: () => void;
  onCloseActionMenu: () => void;
  onComposerAction: (
    id: 'photo' | 'file' | 'request-payment' | 'send-tip' | 'send-tip-list',
  ) => void;
  onReply: (message: GroupMessage) => void;
  onClearReply: () => void;
  onToggleMembers: () => void;
  onChangeAddPubky: (value: string) => void;
  onReact: (eventId: string, authorPubky: string, emoji: string) => void;
  onEdit: (eventId: string) => void;
  onDelete: (eventId: string) => void;
  onAddMember: () => void;
  onRemoveMember: (pubky: string) => void;
  onLeave: () => void;
  onRefreshPublic: () => void;
  onRetryFailed: () => void;
}) {
  const flatListRef = useRef<FlatList<GroupMessage>>(null);
  const plusRef = useRef<View>(null);
  const menuWasOpen = useRef(false);
  const byAuthorEvent = useMemo(() => {
    const map = new Map<string, GroupMessage>();
    for (const msg of messages) map.set(`${msg.senderPubky}:${msg.eventId}`, msg);
    return map;
  }, [messages]);
  const byEventId = useMemo(() => {
    const map = new Map<string, GroupMessage>();
    for (const msg of messages) {
      if (!map.has(msg.eventId)) map.set(msg.eventId, msg);
    }
    return map;
  }, [messages]);
  const reactionsByTarget = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const msg of messages) {
      if (msg.kind !== GROUP_REACTION_KIND || !msg.targetEventId || !msg.targetAuthorPubky) {
        continue;
      }
      const key = `${msg.targetAuthorPubky}:${msg.targetEventId}`;
      const bucket = map.get(key) ?? new Map<string, number>();
      bucket.set(msg.body, (bucket.get(msg.body) ?? 0) + 1);
      map.set(key, bucket);
    }
    return map;
  }, [messages]);

  const visible = messages.filter(isGroupTimelineVisible);
  const activeMembers = members.filter(m => m.status === 'active');
  const isPublic = channel?.isPublic === true;
  const envelopeCtx: DraftEnvelopeContext = {
    surface: isPublic ? 'public-topic' : 'private-group',
  };
  if (channel?.channelId) envelopeCtx.channelId = channel.channelId;
  if (localPubky) envelopeCtx.authorPubky = localPubky;
  if (replyTo?.eventId) envelopeCtx.replyToEventId = replyTo.eventId;
  if (replyTo?.senderPubky) envelopeCtx.replyToAuthorPubky = replyTo.senderPubky;
  const overCap = draftExceedsByteCap(draft, envelopeCtx);
  const byteLabel = messageByteCountLabel(
    draftEnvelopeByteSize(draft, envelopeCtx),
    LINK_MESSAGE_MAX_BYTES,
  );

  useEffect(() => {
    if (actionMenuOpen) {
      menuWasOpen.current = true;
      return;
    }
    if (!menuWasOpen.current) return;
    menuWasOpen.current = false;
    const tag = findNodeHandle(plusRef.current);
    if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, [actionMenuOpen]);

  const renderMessage = useCallback(
    ({ item }: { item: GroupMessage }) => {
      if (item.kind === GROUP_MEMBERSHIP_KIND) {
        return (
          <View style={styles.systemLine}>
            <Text style={styles.systemText}>
              {item.senderPubky.slice(0, 6)}… {item.body}
            </Text>
          </View>
        );
      }
      const isMine = item.senderPubky === localPubky;
      const parent = item.replyToEventId
        ? item.replyToAuthorPubky
          ? byAuthorEvent.get(`${item.replyToAuthorPubky}:${item.replyToEventId}`)
          : byEventId.get(item.replyToEventId)
        : undefined;
      const reactions = reactionsByTarget.get(`${item.senderPubky}:${item.eventId}`);
      const attachment = attachments.find(a => a.eventId === item.eventId);
      return (
        <View style={[styles.bubble, isMine ? styles.mine : styles.theirs]}>
          {!isMine && (
            <Text style={styles.sender} numberOfLines={1} ellipsizeMode="middle">
              {
                peerIdentity(
                  item.senderPubky,
                  contacts.find(c => c.pubky === item.senderPubky) ?? null,
                ).title
              }
            </Text>
          )}
          {parent ? (
            <Text style={styles.replyPreview} numberOfLines={1}>
              ↳ {parent.deleted ? 'deleted' : parent.body}
            </Text>
          ) : null}
          {item.kind === CHAT_ATTACHMENT_KIND && attachment && !item.deleted ? (
            <AttachmentBubble record={attachment} isMine={isMine} onRetrySend={onRetryFailed} />
          ) : (
            <Text style={[styles.bubbleText, isMine ? styles.mineText : styles.theirsText]}>
              {item.deleted ? 'Message deleted' : item.body}
            </Text>
          )}
          <View style={styles.meta}>
            <Text style={styles.time}>{formatTime(item.sentAt)}</Text>
            {item.editedAt ? <Text style={styles.time}> · edited</Text> : null}
            {isMine && !isPublic ? (
              <Text style={styles.time}> · {formatDeliveryState(item.deliveryState)}</Text>
            ) : null}
          </View>
          {reactions && reactions.size > 0 ? (
            <View style={styles.reactionRow}>
              {[...reactions.entries()].map(([emoji, count]) => (
                <Text key={emoji} style={styles.reactionChip}>
                  {emoji} {count}
                </Text>
              ))}
            </View>
          ) : null}
          {!item.deleted && selfActive ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Reply"
                hitSlop={HIT_SLOP_44}
                onPress={() => onReply(item)}
                style={minHitStyle}
              >
                <Text style={styles.action}>Reply</Text>
              </TouchableOpacity>
              {!isPublic
                ? REACTION_EMOJIS.map(emoji => (
                    <TouchableOpacity
                      key={emoji}
                      accessibilityRole="button"
                      accessibilityLabel={`React with ${emoji}`}
                      hitSlop={HIT_SLOP_44}
                      onPress={() => onReact(item.eventId, item.senderPubky, emoji)}
                      style={minHitStyle}
                    >
                      <Text style={styles.action}>{emoji}</Text>
                    </TouchableOpacity>
                  ))
                : null}
              {isMine && !isPublic ? (
                <>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Edit"
                    hitSlop={HIT_SLOP_44}
                    onPress={() => onEdit(item.eventId)}
                    style={minHitStyle}
                  >
                    <Text style={styles.action}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Delete"
                    hitSlop={HIT_SLOP_44}
                    onPress={() => onDelete(item.eventId)}
                    style={minHitStyle}
                  >
                    <Text style={styles.action}>Delete</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    },
    [
      attachments,
      localPubky,
      contacts,
      byAuthorEvent,
      byEventId,
      reactionsByTarget,
      isPublic,
      selfActive,
      onReply,
      onReact,
      onEdit,
      onDelete,
      onRetryFailed,
    ],
  );

  useEffect(() => {
    if (!showMembers) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onToggleMembers();
      return true;
    });
    return () => sub.remove();
  }, [showMembers, onToggleMembers]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={HIT_SLOP_44}
          onPress={onBack}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text
          style={styles.title}
          numberOfLines={1}
          accessibilityLabel={channel ? channel.name : 'Channel'}
        >
          {channel ? `${channel.isPublic ? '#' : ''} ${channel.name}` : 'Channel'}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={showMembers ? 'Chat' : 'Members'}
          accessibilityState={{ expanded: showMembers }}
          hitSlop={HIT_SLOP_44}
          onPress={onToggleMembers}
          style={styles.backBtn}
        >
          <Text style={styles.action}>{showMembers ? 'Chat' : 'Members'}</Text>
        </TouchableOpacity>
      </View>
      {channel ? (
        <View testID="channelDestinationBanner" style={styles.destBanner}>
          <Text testID="channelModeMeta" style={styles.destMeta}>
            {isPublic ? COPY.publicTopic : COPY.privateGroup}
          </Text>
          <Text style={styles.destLine}>
            {isPublic ? COPY.channelDestinationPublic : COPY.channelDestinationPrivate}
          </Text>
          {isPublic ? <Text style={styles.destWarning}>{publicGraphWarning()}</Text> : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#7c3aed" />
        </View>
      ) : showMembers ? (
        <ScrollView contentContainerStyle={styles.memberPane}>
          <Text style={styles.memberHeading}>
            {activeMembers.length}
            {!isPublic ? ` / ${memberCap}` : ''} members
          </Text>
          {members.map(member => (
            <View key={member.memberPubky} style={styles.memberRow}>
              <View style={styles.memberBody}>
                <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="middle">
                  {contactName(contacts, member.memberPubky)}
                </Text>
                <Text style={styles.memberMeta}>
                  {member.role}
                  {member.status === 'removed' ? ' · removed' : ''}
                </Text>
              </View>
              {isAdmin &&
              !isPublic &&
              member.status === 'active' &&
              member.memberPubky !== localPubky ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${contactName(contacts, member.memberPubky)}`}
                  hitSlop={HIT_SLOP_44}
                  onPress={() => onRemoveMember(member.memberPubky)}
                  style={minHitStyle}
                >
                  <Text style={styles.danger}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          {isAdmin && !isPublic ? (
            <View style={styles.addRow}>
              <TextInput
                style={styles.addInput}
                value={addPubky}
                onChangeText={onChangeAddPubky}
                placeholder="Add member pubky"
                placeholderTextColor="#4b5563"
                autoCapitalize="none"
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Add member"
                hitSlop={HIT_SLOP_44}
                onPress={onAddMember}
                style={minHitStyle}
              >
                <Text style={styles.action}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {isPublic ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Refresh from homeserver"
              onPress={onRefreshPublic}
              style={styles.leaveBtn}
            >
              <Text style={styles.action}>Refresh from homeserver</Text>
            </TouchableOpacity>
          ) : null}
          {selfActive ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Leave channel"
              onPress={onLeave}
              style={styles.leaveBtn}
            >
              <Text style={styles.danger}>Leave channel</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.memberMeta}>You have left this channel.</Text>
          )}
        </ScrollView>
      ) : (
        <FlatList
          ref={flatListRef}
          data={visible}
          keyExtractor={item => `${item.senderPubky}:${item.eventId}`}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {selfActive && !showMembers ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {replyTo ? (
            <View style={styles.replyBar}>
              <Text style={styles.replyBarText} numberOfLines={1}>
                Replying to {replyTo.body}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Clear reply"
                hitSlop={HIT_SLOP_44}
                onPress={onClearReply}
                style={minHitStyle}
              >
                <Text style={styles.action}>Clear</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {composerNotice ? (
            <View testID="channelComposerNotice" accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>{composerNotice.message}</Text>
              {composerNotice.actionLabel && composerNotice.onAction ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={composerNotice.actionLabel}
                  hitSlop={HIT_SLOP_44}
                  onPress={composerNotice.onAction}
                  style={minHitStyle}
                >
                  <Text style={styles.action}>{composerNotice.actionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          <View style={styles.composer}>
            <ComposerActionMenu
              visible={actionMenuOpen}
              actions={composerActionItems(isPublic ? 'public-topic' : 'private-group', {
                messagingEnabled: selfActive,
                inboxClosed: false,
                hasTipEndpoints: false,
              })}
              onSelect={onComposerAction}
              onClose={onCloseActionMenu}
            />
            <TouchableOpacity
              ref={plusRef}
              testID="channelComposerPlus"
              accessibilityRole="button"
              accessibilityLabel={COPY.composerAttach}
              hitSlop={HIT_SLOP_44}
              onPress={onOpenActionMenu}
              style={styles.plusBtn}
            >
              <Text style={styles.plusIcon}>+</Text>
            </TouchableOpacity>
            <TextInput
              accessibilityLabel="Message"
              style={styles.input}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Message…"
              placeholderTextColor="#4b5563"
              multiline
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{
                disabled: !draft.trim() || sending || overCap,
              }}
              style={[
                styles.sendBtn,
                (!draft.trim() || sending || overCap) && styles.sendBtnDisabled,
              ]}
              onPress={onSend}
              disabled={!draft.trim() || sending || overCap}
            >
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.sendIcon}>↑</Text>
              )}
            </TouchableOpacity>
          </View>
          <Text
            testID="channelByteCap"
            accessibilityLabel={byteLabel}
            style={[styles.byteCap, overCap && styles.byteCapOver]}
          >
            {byteLabel}. {COPY.messageByteCap}
          </Text>
        </KeyboardAvoidingView>
      ) : null}
    </SafeAreaView>
  );
}

function contactName(contacts: Contact[], pubky: string): string {
  return peerIdentity(pubky, contacts.find(c => c.pubky === pubky) ?? null).title;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  backBtn: { ...minHitStyle },
  backText: { fontSize: 22, color: '#7c3aed' },
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: '#f9fafb', textAlign: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageList: { padding: 16, gap: 8 },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 2,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: '#7c3aed',
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f1f1f',
    borderBottomLeftRadius: 4,
  },
  sender: { fontSize: 10, color: '#c4b5fd', marginBottom: 2 },
  replyPreview: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  mineText: { color: '#fff' },
  theirsText: { color: '#f9fafb' },
  meta: { flexDirection: 'row', marginTop: 4 },
  time: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  reactionChip: { fontSize: 12, color: '#e5e7eb' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  action: { color: '#c4b5fd', fontSize: 12, fontWeight: '600' },
  systemLine: { alignSelf: 'center', paddingVertical: 6 },
  systemText: { color: '#6b7280', fontSize: 12 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#f9fafb',
    fontSize: 15,
    maxHeight: 160,
  },
  plusBtn: {
    ...minHitStyle,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1f1f1f',
  },
  plusIcon: { color: '#c4b5fd', fontSize: 22, fontWeight: '700', marginTop: -2 },
  byteCap: { color: '#808692', fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  byteCapOver: { color: '#fca5a5' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  noticeText: { flex: 1, color: '#fca5a5', fontSize: 13 },
  destBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
    gap: 4,
  },
  destMeta: { color: '#c4b5fd', fontSize: 12, fontWeight: '700' },
  destLine: { color: '#808692', fontSize: 13, lineHeight: 18 },
  destWarning: { color: '#fbbf24', fontSize: 12, lineHeight: 16 },
  sendBtn: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
  replyBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  replyBarText: { color: '#9ca3af', flex: 1, marginRight: 8 },
  memberPane: { padding: 20, gap: 10 },
  memberHeading: { color: '#f9fafb', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  memberBody: { flex: 1 },
  memberName: { color: '#f9fafb', fontSize: 14 },
  memberMeta: { color: '#6b7280', fontSize: 12 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  addInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f9fafb',
  },
  leaveBtn: { marginTop: 16 },
  danger: { color: '#f87171', fontWeight: '600' },
});
