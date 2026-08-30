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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Contact, RootStackParamList } from '../../types';
import type { GroupChannel, GroupMember, GroupMessage } from '../../types/group';
import {
  GROUP_REACTION_KIND,
  GROUP_MEMBERSHIP_KIND,
  GroupServiceError,
  isGroupTimelineVisible,
} from '../../types/group';
import { CHAT_ATTACHMENT_KIND, type AttachmentRecord } from '../../types/attachment';
import { PRIVATE_GROUP_MEMBER_CAP } from '../../flags/config';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { GroupService, subscribeGroupEvents } from '../../services/group/GroupService';
import { AttachmentBubble } from '../../components/AttachmentBubble';
import { ComposerAttachButton } from '../../components/ComposerAttachButton';

type Props = NativeStackScreenProps<RootStackParamList, 'ChannelScreen'>;

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👎'];

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
    setDraft('');
    const replyId = replyTo?.eventId;
    const editId = editingEventId;
    setReplyTo(null);
    setEditingEventId(null);
    setSending(true);
    try {
      if (editId) {
        await GroupService.editMessage(channelId, editId, text);
      } else if (channel.isPublic) {
        if (replyId !== undefined) {
          await GroupService.sendPublicMessage(channelId, text, replyId);
        } else {
          await GroupService.sendPublicMessage(channelId, text);
        }
      } else if (replyId !== undefined) {
        await GroupService.sendGroupMessage(channelId, text, replyId);
      } else {
        await GroupService.sendGroupMessage(channelId, text);
      }
      await reload();
    } catch (err) {
      Alert.alert('Send failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [draft, sending, channel, channelId, replyTo, editingEventId, reload]);

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
      onAttachSent={() => {
        void reload();
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
          Alert.alert('Reaction failed', err instanceof Error ? err.message : String(err));
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
          Alert.alert(
            'Delete failed',
            err instanceof GroupServiceError ? err.message : String(err),
          );
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
          Alert.alert('Add failed', err instanceof GroupServiceError ? err.message : String(err));
        }
      }}
      onRemoveMember={async pubky => {
        try {
          await GroupService.removeMember(channelId, pubky);
          await reload();
        } catch (err) {
          Alert.alert(
            'Remove failed',
            err instanceof GroupServiceError ? err.message : String(err),
          );
        }
      }}
      onLeave={async () => {
        try {
          await GroupService.leaveChannel(channelId);
          nav.goBack();
        } catch (err) {
          Alert.alert('Leave failed', err instanceof Error ? err.message : String(err));
        }
      }}
      onRefreshPublic={async () => {
        try {
          await GroupService.refreshPublicChannel(channelId);
          await reload();
        } catch (err) {
          Alert.alert('Refresh failed', err instanceof Error ? err.message : String(err));
        }
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
  onAttachSent,
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
  onAttachSent: () => void;
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
}) {
  const flatListRef = useRef<FlatList<GroupMessage>>(null);
  const byId = useMemo(() => {
    const map = new Map<string, GroupMessage>();
    for (const msg of messages) map.set(msg.eventId, msg);
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

  const renderMessage = useCallback(
    ({ item }: { item: GroupMessage }) => {
      if (item.kind === GROUP_MEMBERSHIP_KIND) {
        return (
          <View style={styles.systemLine}>
            <Text style={styles.systemText}>
              {item.senderPubky.slice(0, 8)}… {item.body}
            </Text>
          </View>
        );
      }
      const isMine = item.senderPubky === localPubky;
      const parent = item.replyToEventId ? byId.get(item.replyToEventId) : undefined;
      const reactions = reactionsByTarget.get(`${item.senderPubky}:${item.eventId}`);
      const attachment = attachments.find(a => a.eventId === item.eventId);
      return (
        <View style={[styles.bubble, isMine ? styles.mine : styles.theirs]}>
          {!isMine && (
            <Text style={styles.sender} numberOfLines={1} ellipsizeMode="middle">
              {item.senderPubky}
            </Text>
          )}
          {parent ? (
            <Text style={styles.replyPreview} numberOfLines={1}>
              ↳ {parent.deleted ? 'deleted' : parent.body}
            </Text>
          ) : null}
          {item.kind === CHAT_ATTACHMENT_KIND && attachment && !item.deleted ? (
            <AttachmentBubble record={attachment} isMine={isMine} />
          ) : (
            <Text style={[styles.bubbleText, isMine ? styles.mineText : styles.theirsText]}>
              {item.deleted ? 'Message deleted' : item.body}
            </Text>
          )}
          <View style={styles.meta}>
            <Text style={styles.time}>{formatTime(item.sentAt)}</Text>
            {item.editedAt ? <Text style={styles.time}> · edited</Text> : null}
            {isMine && !isPublic ? <Text style={styles.time}> · {item.deliveryState}</Text> : null}
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
              <TouchableOpacity onPress={() => onReply(item)}>
                <Text style={styles.action}>Reply</Text>
              </TouchableOpacity>
              {!isPublic
                ? REACTION_EMOJIS.map(emoji => (
                    <TouchableOpacity
                      key={emoji}
                      onPress={() => onReact(item.eventId, item.senderPubky, emoji)}
                    >
                      <Text style={styles.action}>{emoji}</Text>
                    </TouchableOpacity>
                  ))
                : null}
              {isMine && !isPublic ? (
                <>
                  <TouchableOpacity onPress={() => onEdit(item.eventId)}>
                    <Text style={styles.action}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(item.eventId)}>
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
      byId,
      reactionsByTarget,
      isPublic,
      selfActive,
      onReply,
      onReact,
      onEdit,
      onDelete,
    ],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {channel ? `${channel.isPublic ? '#' : ''} ${channel.name}` : 'Channel'}
        </Text>
        <TouchableOpacity onPress={onToggleMembers} style={styles.backBtn}>
          <Text style={styles.action}>{showMembers ? 'Chat' : 'Members'}</Text>
        </TouchableOpacity>
      </View>

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
                <TouchableOpacity onPress={() => onRemoveMember(member.memberPubky)}>
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
              <TouchableOpacity onPress={onAddMember}>
                <Text style={styles.action}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {isPublic ? (
            <TouchableOpacity onPress={onRefreshPublic} style={styles.leaveBtn}>
              <Text style={styles.action}>Refresh from homeserver</Text>
            </TouchableOpacity>
          ) : null}
          {selfActive ? (
            <TouchableOpacity onPress={onLeave} style={styles.leaveBtn}>
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
              <TouchableOpacity onPress={onClearReply}>
                <Text style={styles.action}>Clear</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.composer}>
            {!isPublic && channel ? (
              <ComposerAttachButton
                target={{ type: 'channel', channelId: channel.channelId }}
                disabled={sending}
                onSent={onAttachSent}
              />
            ) : null}
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Message…"
              placeholderTextColor="#4b5563"
              multiline
              maxLength={4000}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
              onPress={onSend}
              disabled={!draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.sendIcon}>↑</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </SafeAreaView>
  );
}

function contactName(contacts: Contact[], pubky: string): string {
  return contacts.find(c => c.pubky === pubky)?.displayName ?? pubky;
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
  backBtn: { minWidth: 32 },
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
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
