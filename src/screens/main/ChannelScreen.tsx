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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Contact, RootStackParamList } from '../../types';
import type {
  GroupChannel,
  GroupFanoutOutcome,
  GroupMember,
  GroupMessage,
} from '../../types/group';
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
import { eventIdsWithDeliveryQueue } from '../../ui/failedSendRetry';
import {
  pickAndSendFile,
  pickAndSendPhoto,
  sendGifAttachment,
  type ComposerAttachNotice,
} from '../../components/ComposerAttachButton';
import { ComposerActionMenu } from '../../components/ComposerActionMenu';
import { EmojiAutocomplete, EmojiPickerSheet } from '../../components/EmojiPickerSheet';
import { GifPickerSheet } from '../../components/GifPickerSheet';
import { formatDeliveryState } from '../../ui/messageStatus';
import { TagChips, aggregateTags } from '../../ui/TagChips';
import { TagPickerSheet } from '../../ui/TagPickerSheet';
import type { ChatTagRow } from '../../services/StorageService';
import { formatGroupFanoutAggregate } from '../../ui/groupFanoutStatus';
import { HIT_SLOP_44, minHitStyle } from '../../ui/hitTarget';
import { peerIdentity } from '../../ui/peerIdentity';
import { COPY, messageByteCountLabel, publicGraphWarning } from '../../copy/uxCopy';
import { sanitizeError } from '../../ui/sanitizedError';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import {
  applyEmojiAtShortcode,
  matchShortcodeTail,
  replaceClosedShortcodes,
} from '../../lib/emoji/matchShortcode';
import {
  composerActionItems,
  draftEnvelopeByteSize,
  draftExceedsByteCap,
  type ComposerActionId,
  type DraftEnvelopeContext,
} from '../../ui/composerActions';
import { LINK_MESSAGE_MAX_BYTES } from '../../types/link';
import { color, space, radius, typeRole, measure } from '../../theme';
import {
  Avatar,
  Button,
  DaySeparator,
  formatDaySeparator,
  Icon,
  ListRow,
  MarkdownText,
  MessageBubble,
  sameCalendarDay,
} from '../../ui/primitives';
import {
  COMPOSER_KAV_BEHAVIOR,
  COMPOSER_KAV_OFFSET,
  composerDockPadding,
  keyboardLiftHeight,
  subscribeComposerKeyboard,
} from '../../ui/composerKeyboard';

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
  const [fanoutOutcomes, setFanoutOutcomes] = useState<GroupFanoutOutcome[]>([]);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [composerNotice, setComposerNotice] = useState<ComposerAttachNotice | null>(null);
  const [retryableEventIds, setRetryableEventIds] = useState<Set<string>>(() => new Set());
  const [channelPrefs, setChannelPrefs] = useState({ muted: false, archived: false });
  const [chatTags, setChatTags] = useState<ChatTagRow[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<{ eventId: string; authorPubky: string } | null>(null);

  const reload = useCallback(async () => {
    const [ch, msgs, mems, atts, outcomes, loadedTags] = await Promise.all([
      GroupService.getChannel(channelId),
      GroupService.listMessages(channelId),
      GroupService.listMembers(channelId),
      ownerPubky
        ? StorageService.listAttachmentsForChannel(ownerPubky, channelId)
        : Promise.resolve([] as AttachmentRecord[]),
      ownerPubky
        ? StorageService.listGroupFanoutOutcomesForChannel(ownerPubky, channelId)
        : Promise.resolve([] as GroupFanoutOutcome[]),
      ownerPubky
        ? StorageService.listChatTagsForScope(ownerPubky, channelId)
        : Promise.resolve([] as ChatTagRow[]),
    ]);
    setChannel(ch);
    setMessages(msgs);
    setMembers(mems);
    setAttachments(atts);
    setFanoutOutcomes(outcomes);
    setChatTags(loadedTags);
    const failedIds = [
      ...msgs.filter(row => row.deliveryState === 'failed').map(row => row.eventId),
      ...atts.filter(row => row.deliveryState === 'failed').map(row => row.eventId),
    ];
    setRetryableEventIds(await eventIdsWithDeliveryQueue(failedIds));
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
      await LinkService.markGroupRead(channelId, latest > 0 ? latest : Date.now());
      const unread = await StorageService.countUnreadGroupMessages(ownerPubky);
      useSessionStatusStore.getState().setGroupUnreadCount(unread);
    }
  }, [channelId, ownerPubky]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!ownerPubky) return;
    void StorageService.getThreadLocalPrefs(ownerPubky, channelId).then(setChannelPrefs);
  }, [ownerPubky, channelId]);

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
      fanoutOutcomes={fanoutOutcomes}
      tags={chatTags}
      tagPickerOpen={tagPickerOpen}
      onCloseTagPicker={() => {
        setTagPickerOpen(false);
        setTagTarget(null);
      }}
      onPickTag={label => {
        if (!tagTarget) return;
        void LinkService.sendTag({
          peerPubky: localPubky ?? channelId,
          targetEventId: tagTarget.eventId,
          targetAuthorPubky: tagTarget.authorPubky,
          label,
          op: 'add',
          channelId,
        }).then(() => {
          setTagPickerOpen(false);
          setTagTarget(null);
          void reload();
        });
      }}
      onToggleTag={({ eventId, authorPubky, label, mine }) => {
        void LinkService.sendTag({
          peerPubky: localPubky ?? channelId,
          targetEventId: eventId,
          targetAuthorPubky: authorPubky,
          label,
          op: mine ? 'remove' : 'add',
          channelId,
        }).then(() => void reload());
      }}
      onRequestTag={target => {
        setTagTarget(target);
        setTagPickerOpen(true);
      }}
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
      channelMuted={channelPrefs.muted}
      channelArchived={channelPrefs.archived}
      onToggleMute={() => {
        if (!localPubky) return;
        void StorageService.setThreadLocalPrefs(localPubky, channelId, {
          muted: !channelPrefs.muted,
        }).then(() => setChannelPrefs(p => ({ ...p, muted: !p.muted })));
      }}
      onToggleArchive={() => {
        if (!localPubky) return;
        void StorageService.setThreadLocalPrefs(localPubky, channelId, {
          archived: !channelPrefs.archived,
        }).then(() => setChannelPrefs(p => ({ ...p, archived: !p.archived })));
      }}
      onBack={() => nav.goBack()}
      onChangeDraft={value => setDraft(replaceClosedShortcodes(value))}
      onSend={() => {
        void handleSend();
      }}
      actionMenuOpen={actionMenuOpen}
      composerNotice={composerNotice}
      onOpenActionMenu={() => setActionMenuOpen(true)}
      onCloseActionMenu={() => setActionMenuOpen(false)}
      gifPickerOpen={gifPickerOpen}
      emojiPickerOpen={emojiPickerOpen}
      onOpenEmojiPicker={() => setEmojiPickerOpen(true)}
      onCloseEmojiPicker={() => setEmojiPickerOpen(false)}
      onCloseGifPicker={() => setGifPickerOpen(false)}
      onSendGif={gifId => {
        if (!channel) return;
        setGifPickerOpen(false);
        void sendGifAttachment({ type: 'channel', channelId: channel.channelId }, gifId).then(
          result => {
            if (result.ok) void reload();
            else if ('notice' in result) setComposerNotice(result.notice);
          },
        );
      }}
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
          return;
        }
        if (id === 'gif') {
          setGifPickerOpen(true);
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
      retryableEventIds={retryableEventIds}
      onRetryFailed={eventId => {
        void (async () => {
          if (!retryableEventIds.has(eventId)) return;
          try {
            await LinkService.recoverPendingSends();
            await LinkService.drainRetries();
          } catch {
            setRetryableEventIds(prev => {
              const next = new Set(prev);
              next.delete(eventId);
              return next;
            });
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
  fanoutOutcomes,
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
  gifPickerOpen = false,
  emojiPickerOpen = false,
  composerNotice,
  onOpenActionMenu,
  onCloseActionMenu,
  onComposerAction,
  onOpenEmojiPicker,
  onCloseEmojiPicker,
  onCloseGifPicker,
  onSendGif,
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
  retryableEventIds,
  onRetryFailed,
  channelMuted = false,
  channelArchived = false,
  onToggleMute,
  onToggleArchive,
  tags = [],
  tagPickerOpen = false,
  onCloseTagPicker,
  onPickTag,
  onToggleTag,
  onRequestTag,
}: {
  channel: GroupChannel | null;
  messages: GroupMessage[];
  attachments: AttachmentRecord[];
  members: GroupMember[];
  contacts: Contact[];
  fanoutOutcomes: GroupFanoutOutcome[];
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
  gifPickerOpen?: boolean;
  emojiPickerOpen?: boolean;
  composerNotice: ComposerAttachNotice | null;
  onOpenActionMenu: () => void;
  onCloseActionMenu: () => void;
  onComposerAction: (id: ComposerActionId) => void;
  onOpenEmojiPicker?: () => void;
  onCloseEmojiPicker?: () => void;
  onCloseGifPicker?: () => void;
  onSendGif?: (gifId: string) => void;
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
  retryableEventIds: ReadonlySet<string>;
  onRetryFailed: (eventId: string) => void;
  channelMuted?: boolean;
  channelArchived?: boolean;
  onToggleMute?: () => void;
  onToggleArchive?: () => void;
  tags?: ChatTagRow[];
  tagPickerOpen?: boolean;
  onCloseTagPicker?: () => void;
  onPickTag?: (label: string) => void;
  onToggleTag?: (target: {
    eventId: string;
    authorPubky: string;
    label: string;
    mine: boolean;
  }) => void;
  onRequestTag?: (target: { eventId: string; authorPubky: string }) => void;
}) {
  const flatListRef = useRef<FlatList<GroupMessage>>(null);
  const plusRef = useRef<View>(null);
  const menuWasOpen = useRef(false);
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [androidKeyboardLift, setAndroidKeyboardLift] = useState(0);
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
  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      const contact = contacts.find(c => c.pubky === member.memberPubky) ?? null;
      map.set(member.memberPubky, peerIdentity(member.memberPubky, contact).title);
    }
    return map;
  }, [members, contacts]);
  const fanoutByEvent = useMemo(() => {
    const map = new Map<string, GroupFanoutOutcome[]>();
    for (const row of fanoutOutcomes) {
      const list = map.get(row.eventId) ?? [];
      list.push(row);
      map.set(row.eventId, list);
    }
    return map;
  }, [fanoutOutcomes]);
  const isPublic = channel?.isPublic === true;
  const envelopeCtx: DraftEnvelopeContext = {
    surface: isPublic ? 'public-topic' : 'private-group',
  };
  if (channel?.channelId) envelopeCtx.channelId = channel.channelId;
  if (localPubky) envelopeCtx.authorPubky = localPubky;
  if (replyTo?.eventId) envelopeCtx.replyToEventId = replyTo.eventId;
  if (replyTo?.senderPubky) envelopeCtx.replyToAuthorPubky = replyTo.senderPubky;
  const byteSize = draftEnvelopeByteSize(draft, envelopeCtx);
  const overCap = draftExceedsByteCap(draft, envelopeCtx);
  const showByteCap = byteSize >= LINK_MESSAGE_MAX_BYTES * 0.8 || overCap;
  const byteLabel = messageByteCountLabel(byteSize, LINK_MESSAGE_MAX_BYTES);

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
    ({ item, index }: { item: GroupMessage; index: number }) => {
      const previous = visible[index - 1];
      const next = visible[index + 1];
      const grouped = previous ? sameChannelRun(previous, item) : false;
      const lastInGroup = next ? !sameChannelRun(item, next) : true;
      const daySeparator =
        !previous || !sameCalendarDay(previous.sentAt, item.sentAt) ? (
          <DaySeparator label={formatDaySeparator(item.sentAt)} testID="channelDaySeparator" />
        ) : null;
      if (item.kind === GROUP_MEMBERSHIP_KIND) {
        return (
          <>
            {daySeparator}
            <View style={styles.systemLine}>
              <Text style={styles.systemText}>
                {item.senderPubky.slice(0, 6)}… {item.body}
              </Text>
            </View>
          </>
        );
      }
      const isMine = item.senderPubky === localPubky;
      const fanout = fanoutByEvent.get(item.eventId);
      const statusTextVisible =
        isMine && !isPublic && fanout ? fanout.some(outcome => outcome.status !== 'sent') : false;
      const outboundLabel =
        isMine && !isPublic
          ? fanout && fanout.length > 0
            ? formatGroupFanoutAggregate(fanout, memberNames)
            : formatDeliveryState(item.deliveryState)
          : null;
      const parent = item.replyToEventId
        ? item.replyToAuthorPubky
          ? byAuthorEvent.get(`${item.replyToAuthorPubky}:${item.replyToEventId}`)
          : byEventId.get(item.replyToEventId)
        : undefined;
      const reactions = reactionsByTarget.get(`${item.senderPubky}:${item.eventId}`);
      const attachment = attachments.find(a => a.eventId === item.eventId);
      const senderName = peerIdentity(
        item.senderPubky,
        contacts.find(c => c.pubky === item.senderPubky) ?? null,
      ).title;
      return (
        <>
          {daySeparator}
          <MessageBubble
            testID={isMine ? 'channelBubbleMine' : 'channelBubbleTheirs'}
            mine={isMine}
            time={formatTime(item.sentAt)}
            status={outboundLabel}
            statusTextVisible={statusTextVisible}
            failed={item.deliveryState === 'failed'}
            senderName={senderName}
            senderPubky={item.senderPubky}
            showIncomingAvatar={!isMine && !grouped}
            grouped={grouped}
            lastInGroup={lastInGroup}
            accessibilityLabel={item.deleted ? 'Message deleted' : item.body}
            copyBody={item.deleted ? null : item.body}
          >
            {!isMine && (
              <Text style={styles.sender} numberOfLines={1} ellipsizeMode="middle">
                {senderName}
              </Text>
            )}
            {parent ? (
              <Text style={styles.replyPreview} numberOfLines={1}>
                ↳ {parent.deleted ? 'deleted' : parent.body}
              </Text>
            ) : null}
            {item.kind === CHAT_ATTACHMENT_KIND && attachment && !item.deleted ? (
              <AttachmentBubble
                record={attachment}
                isMine={isMine}
                onRetrySend={
                  retryableEventIds.has(attachment.eventId)
                    ? () => onRetryFailed(attachment.eventId)
                    : undefined
                }
              />
            ) : (
              <MarkdownText
                source={item.deleted ? 'Message deleted' : item.body}
                color={isMine ? color.textOnBrand : color.textPrimary}
              />
            )}
            {item.editedAt ? <Text style={styles.time}>edited</Text> : null}
            {isMine && !isPublic && item.deliveryState === 'failed' ? (
              retryableEventIds.has(item.eventId) ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={COPY.retry}
                  hitSlop={HIT_SLOP_44}
                  onPress={() => onRetryFailed(item.eventId)}
                >
                  <Text style={styles.retry}>{COPY.retry}</Text>
                </TouchableOpacity>
              ) : (
                <Text
                  testID="channelSendTerminal"
                  accessibilityRole="text"
                  style={styles.statusFailed}
                >
                  {COPY.couldNotSendStartAgain}
                </Text>
              )
            ) : null}
            {reactions && reactions.size > 0 ? (
              <View style={styles.reactionRow}>
                {[...reactions.entries()].map(([emoji, count]) => (
                  <Text key={emoji} style={styles.reactionChip}>
                    {emoji} {count}
                  </Text>
                ))}
              </View>
            ) : null}
            <TagChips
              tags={aggregateTags(tags, item.senderPubky, item.eventId, localPubky)}
              onToggle={(label, mine) =>
                onToggleTag?.({
                  eventId: item.eventId,
                  authorPubky: item.senderPubky,
                  label,
                  mine,
                })
              }
            />
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
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={COPY.tagMessage}
                  hitSlop={HIT_SLOP_44}
                  onPress={() =>
                    onRequestTag?.({ eventId: item.eventId, authorPubky: item.senderPubky })
                  }
                  style={minHitStyle}
                >
                  <Text style={styles.action}>{COPY.tagMessage}</Text>
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
          </MessageBubble>
        </>
      );
    },
    [
      attachments,
      localPubky,
      contacts,
      fanoutByEvent,
      memberNames,
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
      retryableEventIds,
      visible,
      tags,
      onToggleTag,
      onRequestTag,
    ],
  );

  useEffect(() => {
    return subscribeComposerKeyboard({
      onShow: event => {
        setKeyboardVisible(true);
        setAndroidKeyboardLift(keyboardLiftHeight(event, Platform.OS));
        if (visible.length > 0) {
          flatListRef.current?.scrollToEnd({ animated: true });
        }
      },
      onHide: () => {
        setKeyboardVisible(false);
        setAndroidKeyboardLift(0);
      },
    });
  }, [visible.length]);

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
          <Icon name="chevron-back" tone="brand" />
        </TouchableOpacity>
        <Text
          style={styles.title}
          numberOfLines={1}
          accessibilityLabel={channel ? channel.name : 'Channel'}
        >
          {channel ? `${channel.isPublic ? '#' : ''} ${channel.name}` : 'Channel'}
        </Text>
        {onToggleMute ? (
          <TouchableOpacity
            testID="channelMute"
            accessibilityRole="button"
            accessibilityLabel={channelMuted ? COPY.unmuteChat : COPY.muteChat}
            hitSlop={HIT_SLOP_44}
            onPress={onToggleMute}
            style={styles.backBtn}
          >
            <Icon
              name={channelMuted ? 'notifications-off-outline' : 'notifications-outline'}
              tone="secondary"
            />
          </TouchableOpacity>
        ) : null}
        {onToggleArchive ? (
          <TouchableOpacity
            testID="channelArchive"
            accessibilityRole="button"
            accessibilityLabel={channelArchived ? COPY.unarchiveChat : COPY.archiveChat}
            hitSlop={HIT_SLOP_44}
            onPress={onToggleArchive}
            style={styles.backBtn}
          >
            <Icon name={channelArchived ? 'archive' : 'archive-outline'} tone="secondary" />
          </TouchableOpacity>
        ) : null}
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

      {showMembers ? (
        loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={color.brand} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.memberPane, { paddingBottom: space.xl + bottomInset }]}
          >
            <Text style={styles.memberHeading}>
              {activeMembers.length}
              {!isPublic ? ` / ${memberCap}` : ''} members
            </Text>
            {members.map(member => (
              <ListRow
                key={member.memberPubky}
                title={contactName(contacts, member.memberPubky)}
                subtitle={`${member.role}${member.status === 'removed' ? ' · removed' : ''}`}
                leading={
                  <Avatar
                    name={contactName(contacts, member.memberPubky)}
                    pubky={member.memberPubky}
                    size="md"
                  />
                }
                trailing={
                  isAdmin &&
                  !isPublic &&
                  member.status === 'active' &&
                  member.memberPubky !== localPubky ? (
                    <Button
                      label="Remove"
                      variant="destructive"
                      accessibilityLabel={`Remove ${contactName(contacts, member.memberPubky)}`}
                      onPress={() => onRemoveMember(member.memberPubky)}
                    />
                  ) : undefined
                }
                showChevron={false}
                hideDivider={members[members.length - 1] === member}
              />
            ))}
            {isAdmin && !isPublic ? (
              <View style={styles.addRow}>
                <TextInput
                  style={styles.addInput}
                  value={addPubky}
                  onChangeText={onChangeAddPubky}
                  placeholder="Add member pubky"
                  placeholderTextColor={color.textSecondary}
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
        )
      ) : (
        <KeyboardAvoidingView
          testID="channelKeyboardAvoid"
          style={[
            styles.keyboardAvoid,
            androidKeyboardLift ? { paddingBottom: androidKeyboardLift } : null,
          ]}
          behavior={COMPOSER_KAV_BEHAVIOR}
          keyboardVerticalOffset={COMPOSER_KAV_OFFSET}
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={color.brand} />
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={visible}
              keyExtractor={item => `${item.senderPubky}:${item.eventId}`}
              renderItem={renderMessage}
              style={styles.list}
              contentContainerStyle={[styles.messageList, { paddingBottom: space.xl }]}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            />
          )}

          {selfActive ? (
            <>
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
                <View
                  testID="channelComposerNotice"
                  accessibilityRole="alert"
                  style={styles.notice}
                >
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
              {matchShortcodeTail(draft) ? (
                <EmojiAutocomplete
                  suggestions={matchShortcodeTail(draft)!.suggestions}
                  onPick={glyph => onChangeDraft(applyEmojiAtShortcode(draft, glyph))}
                />
              ) : null}
              <View
                style={[
                  styles.composer,
                  { paddingBottom: composerDockPadding(bottomInset, keyboardVisible) },
                ]}
              >
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
                  <Icon name="add" tone="secondary" />
                </TouchableOpacity>
                <TouchableOpacity
                  testID="channelComposerEmoji"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.emojiPickerTitle}
                  hitSlop={HIT_SLOP_44}
                  onPress={onOpenEmojiPicker}
                  style={styles.plusBtn}
                >
                  <Icon name="happy-outline" tone="secondary" />
                </TouchableOpacity>
                <TextInput
                  testID="channelComposer"
                  accessibilityLabel="Message"
                  style={styles.input}
                  value={draft}
                  onChangeText={onChangeDraft}
                  placeholder="Message…"
                  placeholderTextColor={color.textSecondary}
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
                    <ActivityIndicator color={color.textOnBrand} size="small" />
                  ) : (
                    <Icon
                      name="arrow-up"
                      tone={!draft.trim() || sending || overCap ? 'muted' : 'onBrand'}
                    />
                  )}
                </TouchableOpacity>
              </View>
              {showByteCap ? (
                <Text
                  testID="channelByteCap"
                  accessibilityLabel={byteLabel}
                  numberOfLines={1}
                  style={[
                    styles.byteCap,
                    byteSize >= LINK_MESSAGE_MAX_BYTES * 0.95 && styles.byteCapOver,
                  ]}
                >
                  {byteLabel}
                </Text>
              ) : null}
              <TagPickerSheet
                visible={tagPickerOpen}
                onClose={() => onCloseTagPicker?.()}
                onPick={label => onPickTag?.(label)}
              />
              <EmojiPickerSheet
                visible={emojiPickerOpen}
                onClose={() => onCloseEmojiPicker?.()}
                onPick={glyph => {
                  onChangeDraft(`${draft}${glyph}`);
                  onCloseEmojiPicker?.();
                }}
              />
              <GifPickerSheet
                visible={gifPickerOpen}
                onClose={() => onCloseGifPicker?.()}
                onPick={hit => onSendGif?.(hit.id)}
              />
            </>
          ) : null}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function contactName(contacts: Contact[], pubky: string): string {
  return peerIdentity(pubky, contacts.find(c => c.pubky === pubky) ?? null).title;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function sameChannelRun(previous: GroupMessage, next: GroupMessage): boolean {
  if (previous.kind === GROUP_MEMBERSHIP_KIND || next.kind === GROUP_MEMBERSHIP_KIND) return false;
  return previous.senderPubky === next.senderPubky && sameCalendarDay(previous.sentAt, next.sentAt);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.canvas },
  keyboardAvoid: { flex: 1 },
  list: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  backBtn: { ...minHitStyle },
  backText: { fontSize: typeRole.heading.fontSize, color: color.brand },
  title: {
    flex: 1,
    fontSize: typeRole.titleStack.fontSize,
    fontWeight: '700',
    color: color.textPrimary,
    textAlign: 'center',
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageList: { padding: space.lg, gap: space.sm },
  daySeparator: { alignItems: 'center', paddingVertical: space.md },
  daySeparatorText: {
    color: color.textMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
  sender: { fontSize: typeRole.meta.fontSize, color: color.brandMuted, marginBottom: 2 },
  replyPreview: {
    fontSize: typeRole.meta.fontSize,
    color: color.textOnBrandUi,
    marginBottom: space.xs,
  },
  bubbleText: { fontSize: typeRole.callout.fontSize, lineHeight: 20 },
  mineText: { color: color.textOnBrand },
  theirsText: { color: color.textPrimary },
  meta: {
    flexDirection: 'row',
    marginTop: space.xs,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  time: { fontSize: typeRole.meta.fontSize, color: color.textOnBrandUi },
  statusFailed: { color: color.danger },
  retry: {
    fontSize: typeRole.meta.fontSize,
    color: color.brandMuted,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  reactionChip: { fontSize: typeRole.meta.fontSize, color: color.textPrimary },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  action: { color: color.brandMuted, fontSize: typeRole.meta.fontSize, fontWeight: '600' },
  systemLine: { alignSelf: 'center', paddingVertical: space.sm },
  systemText: { color: color.textSecondary, fontSize: typeRole.meta.fontSize },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceRaised,
    backgroundColor: color.canvas,
  },
  input: {
    flex: 1,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: color.textPrimary,
    fontSize: typeRole.callout.fontSize,
    maxHeight: 160,
  },
  plusBtn: {
    ...minHitStyle,
    width: 44,
    height: 44,
    borderRadius: radius.xxl,
    backgroundColor: color.bubbleIncoming,
  },
  plusIcon: {
    color: color.brandMuted,
    fontSize: typeRole.heading.fontSize,
    fontWeight: '700',
    marginTop: -2,
  },
  byteCap: {
    color: color.textSecondary,
    fontSize: typeRole.meta.fontSize,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  byteCapOver: { color: color.danger },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  noticeText: { flex: 1, color: color.danger, fontSize: typeRole.caption.fontSize },
  destBanner: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
    gap: space.xs,
  },
  destMeta: { color: color.brandMuted, fontSize: typeRole.meta.fontSize, fontWeight: '700' },
  destLine: { color: color.textSecondary, fontSize: typeRole.caption.fontSize, lineHeight: 18 },
  destWarning: { color: color.warningStrong, fontSize: typeRole.meta.fontSize, lineHeight: 16 },
  sendBtn: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    width: 44,
    height: 44,
    borderRadius: radius.xxl,
    backgroundColor: color.brand,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { color: color.textOnBrand, fontSize: typeRole.numeric.fontSize, fontWeight: '700' },
  replyBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  replyBarText: { color: color.textMuted, flex: 1, marginRight: space.sm },
  memberPane: { padding: space.xl, gap: space.md },
  memberHeading: {
    color: color.textPrimary,
    fontSize: typeRole.body.fontSize,
    fontWeight: '700',
    marginBottom: space.sm,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  memberBody: { flex: 1 },
  memberName: { color: color.textPrimary, fontSize: typeRole.secondary.fontSize },
  memberMeta: { color: color.textSecondary, fontSize: typeRole.meta.fontSize },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  addInput: {
    flex: 1,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: color.textPrimary,
  },
  leaveBtn: { marginTop: space.lg },
  danger: { color: color.danger, fontWeight: '600' },
});
