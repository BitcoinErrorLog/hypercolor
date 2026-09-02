import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  TextInput,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { Contact, MainTabParamList, RootStackParamList } from '../../types';
import { PRIVATE_GROUP_MEMBER_CAP } from '../../flags/config';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import {
  GroupService,
  takePendingPublicJoin,
  subscribeGroupEvents,
} from '../../services/group/GroupService';
import { COPY, publicGraphWarning } from '../../copy/uxCopy';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import {
  filterChannelsByMode,
  mayReadPublicGraph,
  parseChannelMode,
  publicListVisible,
  withUnreadCounts,
  type ChannelListItem,
  type ChannelMode,
} from '../../ui/channelList';
import { modalAnimationType, useReduceMotion } from '../../ui/reduceMotion';
import { sanitizeError } from '../../ui/sanitizedError';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ChannelsRoute = RouteProp<MainTabParamList, 'Channels'>;

function alertSanitized(err: unknown, fallback: string): void {
  const sanitized = sanitizeError(err, fallback);
  Alert.alert(sanitized.message);
}

export default function ChannelsScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<ChannelsRoute>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [mode, setMode] = useState<ChannelMode>(() => parseChannelMode(route.params?.mode));
  const [publicOptIn, setPublicOptIn] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [createPublicDefault, setCreatePublicDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publicReads, setPublicReads] = useState(0);

  const reload = useCallback(async () => {
    if (!ownerPubky) {
      setChannels([]);
      setContacts([]);
      return;
    }
    const [rows, unread, people] = await Promise.all([
      GroupService.listChannels(),
      StorageService.unreadCountsForGroupChannels(ownerPubky),
      StorageService.getAllContacts(ownerPubky),
    ]);
    setChannels(withUnreadCounts(rows, unread));
    setContacts(people);
  }, [ownerPubky]);

  useEffect(() => {
    setMode(parseChannelMode(route.params?.mode));
  }, [route.params?.mode]);

  const tryPendingJoin = useCallback(() => {
    if (!mayReadPublicGraph(publicOptIn)) return;
    const pending = takePendingPublicJoin();
    if (!pending) return;
    setPublicReads(n => n + 1);
    void GroupService.joinPublicChannel(pending)
      .then(ch => {
        nav.navigate('ChannelScreen', { channelId: ch.channelId });
      })
      .catch(err => {
        alertSanitized(err, COPY.couldNotJoinChannel);
      });
  }, [nav, publicOptIn]);

  useEffect(() => {
    tryPendingJoin();
  }, [publicOptIn, tryPendingJoin]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      tryPendingJoin();
    }, [reload, tryPendingJoin]),
  );

  useEffect(() => {
    if (!ownerPubky) return;
    return subscribeGroupEvents(owner => {
      if (owner === ownerPubky) void reload();
    });
  }, [ownerPubky, reload]);

  return (
    <ChannelsScreenContent
      channels={channels}
      contacts={contacts}
      mode={mode}
      publicOptIn={publicOptIn}
      publicReads={publicReads}
      createOpen={createOpen}
      joinOpen={joinOpen}
      createPublicDefault={createPublicDefault}
      busy={busy}
      memberCap={PRIVATE_GROUP_MEMBER_CAP}
      onModeChange={next => {
        setMode(next);
      }}
      onLoadPublic={() => {
        setPublicOptIn(true);
      }}
      onOpenCreate={isPublic => {
        setCreatePublicDefault(isPublic);
        setCreateOpen(true);
      }}
      onCloseCreate={() => setCreateOpen(false)}
      onOpenJoin={() => setJoinOpen(true)}
      onCloseJoin={() => setJoinOpen(false)}
      onCreatePrivate={async (name, memberPubkys) => {
        setBusy(true);
        try {
          const channel = await GroupService.createChannel(name, memberPubkys);
          setCreateOpen(false);
          await reload();
          nav.navigate('ChannelScreen', { channelId: channel.channelId });
        } catch (err) {
          alertSanitized(err, COPY.couldNotCreateGroup);
        } finally {
          setBusy(false);
        }
      }}
      onCreatePublic={async name => {
        setBusy(true);
        setPublicReads(n => n + 1);
        try {
          const channel = await GroupService.createPublicChannel(name);
          setCreateOpen(false);
          await reload();
          nav.navigate('ChannelScreen', { channelId: channel.channelId });
        } catch (err) {
          alertSanitized(err, COPY.couldNotCreateChannel);
        } finally {
          setBusy(false);
        }
      }}
      onJoinPublic={async ref => {
        if (!mayReadPublicGraph(publicOptIn)) return;
        setBusy(true);
        setPublicReads(n => n + 1);
        try {
          const channel = await GroupService.joinPublicChannel(ref);
          setJoinOpen(false);
          await reload();
          nav.navigate('ChannelScreen', { channelId: channel.channelId });
        } catch (err) {
          alertSanitized(err, COPY.couldNotJoinChannel);
        } finally {
          setBusy(false);
        }
      }}
      onOpenChannel={channelId => nav.navigate('ChannelScreen', { channelId })}
    />
  );
}

export function ChannelsScreenContent({
  channels,
  contacts,
  mode,
  publicOptIn,
  publicReads,
  createOpen,
  joinOpen,
  createPublicDefault,
  busy,
  memberCap,
  onModeChange,
  onLoadPublic,
  onOpenCreate,
  onCloseCreate,
  onOpenJoin,
  onCloseJoin,
  onCreatePrivate,
  onCreatePublic,
  onJoinPublic,
  onOpenChannel,
}: {
  channels: ChannelListItem[];
  contacts: Contact[];
  mode: ChannelMode;
  publicOptIn: boolean;
  publicReads: number;
  createOpen: boolean;
  joinOpen: boolean;
  createPublicDefault: boolean;
  busy: boolean;
  memberCap: number;
  onModeChange: (mode: ChannelMode) => void;
  onLoadPublic: () => void;
  onOpenCreate: (isPublic: boolean) => void;
  onCloseCreate: () => void;
  onOpenJoin: () => void;
  onCloseJoin: () => void;
  onCreatePrivate: (name: string, memberPubkys: string[]) => void;
  onCreatePublic: (name: string) => void;
  onJoinPublic: (ref: string) => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const reduceMotion = useReduceMotion();
  const [name, setName] = useState('');
  const [publicOverride, setPublicOverride] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [joinRef, setJoinRef] = useState('');
  const isPublic = publicOverride ?? createPublicDefault;

  const visible = useMemo(() => {
    const filtered = filterChannelsByMode(channels, mode);
    if (mode === 'public' && !publicListVisible(publicOptIn)) return [];
    return filtered;
  }, [channels, mode, publicOptIn]);

  const selectedPubkys = Object.keys(selected).filter(k => selected[k]);
  const animation = modalAnimationType(reduceMotion);

  const renderChannel = useCallback(
    ({ item }: { item: ChannelListItem }) => (
      <TouchableOpacity
        testID={item.isPublic ? 'channelRowPublic' : 'channelRowPrivate'}
        style={styles.row}
        onPress={() => onOpenChannel(item.channelId)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.isPublic ? COPY.publicTopic : COPY.privateGroup}${
          item.unreadCount > 0 ? `, ${item.unreadCount} unread` : ''
        }`}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {item.isPublic ? '#' : item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.body}>
          <View style={styles.rowHeader}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            {item.lastMessageAt ? (
              <Text style={styles.time}>{formatRelativeTime(item.lastMessageAt)}</Text>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {item.isPublic ? COPY.publicTopic : COPY.privateGroup}
            </Text>
            {item.unreadCount > 0 ? (
              <View testID="channelUnreadBadge" style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.unreadCount > 99 ? '99+' : item.unreadCount}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    ),
    [onOpenChannel],
  );

  const emptyPrivate = (
    <View testID="channelsEmptyPrivate" style={styles.empty}>
      <Text style={styles.emptyText}>{COPY.noPrivateGroupsYet}</Text>
      <Text style={styles.emptyHint}>{COPY.privateGroupsEmptyBody}</Text>
      <TouchableOpacity
        testID="channelsEmptyCreatePrivate"
        accessibilityRole="button"
        accessibilityLabel={COPY.newPrivateGroup}
        hitSlop={HIT_SLOP_44}
        onPress={() => onOpenCreate(false)}
        style={styles.emptyAction}
      >
        <Text style={styles.emptyActionText}>{COPY.newPrivateGroup}</Text>
      </TouchableOpacity>
    </View>
  );

  const emptyPublic = publicOptIn ? (
    <View testID="channelsEmptyPublic" style={styles.empty}>
      <Text style={styles.emptyText}>{COPY.noPublicTopicsYet}</Text>
      <Text style={styles.emptyHint}>{COPY.publicTopicsEmptyBody}</Text>
      <TouchableOpacity
        testID="channelsEmptyJoin"
        accessibilityRole="button"
        accessibilityLabel={COPY.joinByLink}
        hitSlop={HIT_SLOP_44}
        onPress={onOpenJoin}
        style={styles.emptyAction}
      >
        <Text style={styles.emptyActionText}>{COPY.joinByLink}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <View testID="channelsPublicGate" style={styles.empty}>
      <Text style={styles.emptyHint}>{COPY.publicTopicsEmptyBody}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} testID="channelsScreen">
      <View style={styles.header}>
        <Text style={styles.title}>{COPY.channelsTitle}</Text>
        <View style={styles.headerActions}>
          {mode === 'public' && publicOptIn ? (
            <TouchableOpacity
              testID="channelsJoin"
              accessibilityRole="button"
              accessibilityLabel={COPY.joinByLink}
              hitSlop={HIT_SLOP_44}
              onPress={onOpenJoin}
              style={styles.headerHit}
            >
              <Text style={styles.action}>{COPY.joinByLink}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            testID="channelsNew"
            accessibilityRole="button"
            accessibilityLabel={mode === 'public' ? COPY.newPublicTopic : COPY.newPrivateGroup}
            hitSlop={HIT_SLOP_44}
            onPress={() => onOpenCreate(mode === 'public')}
            style={styles.headerHit}
          >
            <Text style={styles.add}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View testID="channelsModeControl" style={styles.segment} accessibilityRole="tablist">
        <TouchableOpacity
          testID="channelsModePrivate"
          accessibilityRole="tab"
          accessibilityLabel={COPY.channelsPrivate}
          accessibilityState={{ selected: mode === 'private' }}
          hitSlop={HIT_SLOP_44}
          onPress={() => onModeChange('private')}
          style={[styles.segmentBtn, mode === 'private' && styles.segmentOn]}
        >
          <Text style={styles.segmentText}>{COPY.channelsPrivate}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="channelsModePublic"
          accessibilityRole="tab"
          accessibilityLabel={COPY.channelsPublic}
          accessibilityState={{ selected: mode === 'public' }}
          hitSlop={HIT_SLOP_44}
          onPress={() => onModeChange('public')}
          style={[styles.segmentBtn, mode === 'public' && styles.segmentOn]}
        >
          <Text style={styles.segmentText}>{COPY.channelsPublic}</Text>
        </TouchableOpacity>
      </View>

      {mode === 'public' ? (
        <View testID="channelsPublicWarning" style={styles.warning}>
          <Text style={styles.warningTitle}>{COPY.publicGraphWarningTitle}</Text>
          <Text style={styles.warningBody}>{publicGraphWarning()}</Text>
          <Text style={styles.substrate}>{COPY.publicSubstrateMobile}</Text>
          {!publicOptIn ? (
            <TouchableOpacity
              testID="channelsLoadPublic"
              accessibilityRole="button"
              accessibilityLabel={COPY.loadPublicTopics}
              hitSlop={HIT_SLOP_44}
              onPress={onLoadPublic}
              style={styles.loadBtn}
            >
              <Text style={styles.loadBtnText}>{COPY.loadPublicTopics}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <Text testID="channelsPublicReadCount" style={styles.readProbe}>
        {String(publicReads)}
      </Text>

      {visible.length === 0 ? (
        mode === 'private' ? (
          emptyPrivate
        ) : (
          emptyPublic
        )
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.channelId}
          renderItem={renderChannel}
          contentContainerStyle={styles.list}
        />
      )}

      <Modal
        visible={createOpen}
        animationType={animation}
        transparent
        onRequestClose={() => {
          setPublicOverride(null);
          onCloseCreate();
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{COPY.newChannelSheetTitle}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor="#4b5563"
              accessibilityLabel="Channel name"
            />
            <View style={styles.toggleRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={COPY.privateGroup}
                accessibilityState={{ selected: !isPublic }}
                hitSlop={HIT_SLOP_44}
                style={[styles.toggle, !isPublic && styles.toggleOn]}
                onPress={() => setPublicOverride(false)}
              >
                <Text style={styles.toggleText}>{COPY.privateGroup}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={COPY.channelsPublic}
                accessibilityState={{ selected: isPublic }}
                hitSlop={HIT_SLOP_44}
                style={[styles.toggle, isPublic && styles.toggleOn]}
                onPress={() => setPublicOverride(true)}
              >
                <Text style={styles.toggleText}>{COPY.channelsPublic}</Text>
              </TouchableOpacity>
            </View>
            {!isPublic ? (
              <ScrollView style={styles.memberList}>
                <Text style={styles.hint}>
                  Members ({selectedPubkys.length + 1}/{memberCap}, including you)
                </Text>
                {contacts.map(contact => {
                  const on = selected[contact.pubky] === true;
                  const wouldExceed = !on && selectedPubkys.length + 1 >= memberCap;
                  return (
                    <TouchableOpacity
                      key={contact.pubky}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`Select ${contact.displayName ?? 'member'}`}
                      accessibilityState={{ checked: on, disabled: wouldExceed }}
                      hitSlop={HIT_SLOP_44}
                      style={styles.memberRow}
                      disabled={wouldExceed}
                      onPress={() =>
                        setSelected(cur => ({
                          ...cur,
                          [contact.pubky]: !on,
                        }))
                      }
                    >
                      <Text style={[styles.memberName, on && styles.memberOn]}>
                        {on ? '✓ ' : ''}
                        {contact.displayName ?? contact.pubky}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <View testID="createPublicWarning">
                <Text style={styles.hint}>{publicGraphWarning()}</Text>
                <Text style={styles.hint}>{COPY.publicSubstrateMobile}</Text>
              </View>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={COPY.cancel}
                hitSlop={HIT_SLOP_44}
                onPress={() => {
                  setPublicOverride(null);
                  onCloseCreate();
                }}
                disabled={busy}
                style={styles.modalHit}
              >
                <Text style={styles.action}>{COPY.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Create"
                accessibilityState={{ busy, disabled: busy || name.trim().length === 0 }}
                hitSlop={HIT_SLOP_44}
                disabled={busy || name.trim().length === 0}
                onPress={() => {
                  if (isPublic) onCreatePublic(name);
                  else onCreatePrivate(name, selectedPubkys);
                }}
                style={styles.modalHit}
              >
                <Text style={styles.actionPrimary}>{busy ? '…' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={joinOpen} animationType={animation} transparent onRequestClose={onCloseJoin}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{COPY.joinPublicTopicTitle}</Text>
            <Text style={styles.hint}>{publicGraphWarning()}</Text>
            <TextInput
              style={styles.input}
              value={joinRef}
              onChangeText={setJoinRef}
              placeholder="hypercolor://join-public?channel=…"
              placeholderTextColor="#4b5563"
              autoCapitalize="none"
              accessibilityLabel="Public topic invite link"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={COPY.cancel}
                hitSlop={HIT_SLOP_44}
                onPress={onCloseJoin}
                disabled={busy}
                style={styles.modalHit}
              >
                <Text style={styles.action}>{COPY.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={COPY.joinByLink}
                accessibilityState={{
                  busy,
                  disabled: busy || joinRef.trim().length === 0 || !publicOptIn,
                }}
                hitSlop={HIT_SLOP_44}
                disabled={busy || joinRef.trim().length === 0 || !publicOptIn}
                onPress={() => onJoinPublic(joinRef)}
                style={styles.modalHit}
              >
                <Text style={styles.actionPrimary}>{busy ? '…' : 'Join'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(ms).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#f9fafb' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerHit: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  action: { color: '#7c3aed', fontSize: 16, fontWeight: '600' },
  actionPrimary: { color: '#c4b5fd', fontSize: 16, fontWeight: '700' },
  add: { fontSize: 28, color: '#7c3aed', fontWeight: '600' },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: '#4c1d95' },
  segmentText: { color: '#f9fafb', fontWeight: '600' },
  warning: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1f1b2e',
    gap: 6,
  },
  warningTitle: { color: '#c4b5fd', fontSize: 14, fontWeight: '700' },
  warningBody: { color: '#f9fafb', fontSize: 13, lineHeight: 18 },
  substrate: { color: '#808692', fontSize: 13, lineHeight: 18 },
  loadBtn: {
    minHeight: 44,
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  readProbe: { height: 0, opacity: 0, overflow: 'hidden' },
  list: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 44,
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1f2937',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '600', color: '#7c3aed' },
  body: { flex: 1, gap: 3 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: '#f9fafb' },
  time: { fontSize: 12, color: '#808692' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  meta: { fontSize: 13, color: '#808692', flex: 1 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24 },
  emptyText: { color: '#f9fafb', fontSize: 16, fontWeight: '600' },
  emptyHint: { color: '#808692', fontSize: 14, textAlign: 'center', paddingHorizontal: 12 },
  emptyAction: {
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#f9fafb' },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    color: '#f9fafb',
    fontSize: 15,
  },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggle: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
  },
  toggleOn: { backgroundColor: '#4c1d95' },
  toggleText: { color: '#f9fafb', fontWeight: '600' },
  memberList: { maxHeight: 240 },
  memberRow: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  memberName: { color: '#9ca3af', fontSize: 14 },
  memberOn: { color: '#c4b5fd', fontWeight: '600' },
  hint: { color: '#808692', fontSize: 13, lineHeight: 18 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  modalHit: { minHeight: 44, justifyContent: 'center' },
});
