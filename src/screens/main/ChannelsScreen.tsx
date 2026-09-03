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
  dismissPendingPublicJoin,
  peekPendingPublicInvite,
  subscribeGroupEvents,
  takePendingPublicJoin,
} from '../../services/group/GroupService';
import { parsePublicChannelRef } from '../../types/group';
import { COPY, pendingInviteChannelHost, publicGraphWarning } from '../../copy/uxCopy';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { shortPubky } from '../../ui/shortPubky';
import {
  filterChannelsByMode,
  mayReadPublicGraph,
  mayWritePublicGraph,
  parseChannelMode,
  publicListVisible,
  withUnreadCounts,
  type ChannelListItem,
  type ChannelMode,
} from '../../ui/channelList';
import { modalAnimationType, useReduceMotion } from '../../ui/reduceMotion';
import { sanitizeError } from '../../ui/sanitizedError';
import { color, space, radius, typeRole, measure } from '../../theme';

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
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);

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

  const refreshPendingInvite = useCallback(() => {
    if (!ownerPubky) {
      setPendingInvite(null);
      return;
    }
    setPendingInvite(peekPendingPublicInvite(ownerPubky));
  }, [ownerPubky]);

  useEffect(() => {
    setMode(parseChannelMode(route.params?.mode));
  }, [route.params?.mode]);

  useEffect(() => {
    refreshPendingInvite();
  }, [refreshPendingInvite]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      refreshPendingInvite();
    }, [reload, refreshPendingInvite]),
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
      createOpen={createOpen}
      joinOpen={joinOpen}
      createPublicDefault={createPublicDefault}
      busy={busy}
      pendingInvite={pendingInvite}
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
        if (!mayWritePublicGraph(publicOptIn)) return;
        setBusy(true);
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
      onConfirmPendingJoin={async () => {
        if (!ownerPubky || !mayReadPublicGraph(publicOptIn)) return;
        const pending = takePendingPublicJoin(ownerPubky);
        refreshPendingInvite();
        if (!pending) return;
        setBusy(true);
        try {
          const channel = await GroupService.joinPublicChannel(pending);
          await reload();
          nav.navigate('ChannelScreen', { channelId: channel.channelId });
        } catch (err) {
          alertSanitized(err, COPY.couldNotJoinChannel);
        } finally {
          setBusy(false);
        }
      }}
      onDismissPendingJoin={() => {
        if (!ownerPubky) return;
        dismissPendingPublicJoin(ownerPubky);
        refreshPendingInvite();
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
  createOpen,
  joinOpen,
  createPublicDefault,
  busy,
  pendingInvite,
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
  onConfirmPendingJoin,
  onDismissPendingJoin,
  onOpenChannel,
}: {
  channels: ChannelListItem[];
  contacts: Contact[];
  mode: ChannelMode;
  publicOptIn: boolean;
  createOpen: boolean;
  joinOpen: boolean;
  createPublicDefault: boolean;
  busy: boolean;
  pendingInvite: string | null;
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
  onConfirmPendingJoin: () => void;
  onDismissPendingJoin: () => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const reduceMotion = useReduceMotion();
  const [name, setName] = useState('');
  const [publicOverride, setPublicOverride] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [joinRef, setJoinRef] = useState('');
  const isPublic = publicOptIn && (publicOverride ?? createPublicDefault);
  const pendingInviteParsed = pendingInvite ? parsePublicChannelRef(pendingInvite) : null;
  const pendingInviteDetail = pendingInviteParsed
    ? pendingInviteChannelHost(
        pendingInviteParsed.localId,
        shortPubky(pendingInviteParsed.hostPubky),
      )
    : null;

  const visible = useMemo(() => {
    const filtered = filterChannelsByMode(channels, mode);
    if (mode === 'public' && !publicListVisible(publicOptIn)) return [];
    return filtered;
  }, [channels, mode, publicOptIn]);

  const selectedPubkys = Object.keys(selected).filter(k => selected[k]);
  const animation = modalAnimationType(reduceMotion, 'slide');

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

      {pendingInvite ? (
        <View testID="channelsPendingInvite" accessibilityRole="alert" style={styles.pendingInvite}>
          <Text style={styles.pendingTitle}>{COPY.pendingPublicInvite}</Text>
          {pendingInviteDetail ? (
            <Text testID="channelsPendingInviteDetail" style={styles.pendingBody}>
              {pendingInviteDetail}
            </Text>
          ) : null}
          {!publicOptIn ? (
            <Text style={styles.pendingBody}>{COPY.loadPublicTopicsToJoin}</Text>
          ) : null}
          <View style={styles.pendingActions}>
            <TouchableOpacity
              testID="channelsPendingDismiss"
              accessibilityRole="button"
              accessibilityLabel={COPY.dismissPendingInvite}
              hitSlop={HIT_SLOP_44}
              onPress={onDismissPendingJoin}
              style={styles.pendingHit}
            >
              <Text style={styles.action}>{COPY.dismissPendingInvite}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="channelsPendingJoin"
              accessibilityRole="button"
              accessibilityLabel={COPY.joinPendingInvite}
              accessibilityState={{ disabled: busy || !publicOptIn }}
              hitSlop={HIT_SLOP_44}
              disabled={busy || !publicOptIn}
              onPress={onConfirmPendingJoin}
              style={styles.pendingHit}
            >
              <Text style={styles.actionPrimary}>{COPY.joinPendingInvite}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

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
              placeholderTextColor={color.textSecondary}
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
                accessibilityState={{ selected: isPublic, disabled: !publicOptIn }}
                hitSlop={HIT_SLOP_44}
                disabled={!publicOptIn}
                style={[styles.toggle, isPublic && styles.toggleOn]}
                onPress={() => {
                  if (!publicOptIn) return;
                  setPublicOverride(true);
                }}
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
                  if (isPublic) {
                    if (!mayWritePublicGraph(publicOptIn)) return;
                    onCreatePublic(name);
                  } else onCreatePrivate(name, selectedPubkys);
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
              placeholderTextColor={color.textSecondary}
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
  container: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  title: { fontSize: typeRole.title.fontSize, fontWeight: '700', color: color.textPrimary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  headerHit: { minHeight: measure.hitTarget, minWidth: measure.hitTarget, justifyContent: 'center', alignItems: 'center' },
  action: { color: color.brand, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  actionPrimary: { color: color.brandMuted, fontSize: typeRole.body.fontSize, fontWeight: '700' },
  add: { fontSize: typeRole.display.fontSize, color: color.brand, fontWeight: '600' },
  segment: {
    flexDirection: 'row',
    marginHorizontal: space.lg,
    marginTop: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.xs,
    gap: space.xs,
  },
  segmentBtn: {
    flex: 1,
    minHeight: measure.hitTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: color.brandDeep },
  segmentText: { color: color.textPrimary, fontWeight: '600' },
  warning: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceBrand,
    gap: space.sm,
  },
  warningTitle: { color: color.brandMuted, fontSize: typeRole.secondary.fontSize, fontWeight: '700' },
  warningBody: { color: color.textPrimary, fontSize: typeRole.caption.fontSize, lineHeight: 18 },
  substrate: { color: color.textSecondary, fontSize: typeRole.caption.fontSize, lineHeight: 18 },
  pendingInvite: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceBrand,
    gap: space.sm,
  },
  pendingTitle: { color: color.brandMuted, fontSize: typeRole.secondary.fontSize, fontWeight: '700' },
  pendingBody: { color: color.textPrimary, fontSize: typeRole.caption.fontSize, lineHeight: 18 },
  pendingActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pendingHit: { minHeight: measure.hitTarget, justifyContent: 'center' },
  loadBtn: {
    minHeight: measure.hitTarget,
    marginTop: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadBtnText: { color: color.textOnBrand, fontSize: typeRole.callout.fontSize, fontWeight: '700' },
  list: { paddingVertical: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    gap: space.lg,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.xxl,
    backgroundColor: color.well,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: typeRole.heading.fontSize, fontWeight: '600', color: color.brand },
  body: { flex: 1, gap: 3 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  name: { flex: 1, fontSize: typeRole.body.fontSize, fontWeight: '600', color: color.textPrimary },
  time: { fontSize: typeRole.meta.fontSize, color: color.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  meta: { fontSize: typeRole.caption.fontSize, color: color.textSecondary, flex: 1 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.md,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  badgeText: { color: color.textOnBrand, fontSize: typeRole.meta.fontSize, fontWeight: '700' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.sm, padding: space.xxl },
  emptyText: { color: color.textPrimary, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  emptyHint: { color: color.textSecondary, fontSize: typeRole.secondary.fontSize, textAlign: 'center', paddingHorizontal: space.md },
  emptyAction: {
    minHeight: measure.hitTarget,
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: { color: color.textOnBrand, fontSize: typeRole.callout.fontSize, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: color.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: space.xl,
    gap: space.md,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: typeRole.numeric.fontSize, fontWeight: '700', color: color.textPrimary },
  input: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    color: color.textPrimary,
    fontSize: typeRole.callout.fontSize,
  },
  toggleRow: { flexDirection: 'row', gap: space.sm },
  toggle: {
    flex: 1,
    minHeight: measure.hitTarget,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceRaised,
  },
  toggleOn: { backgroundColor: color.brandDeep },
  toggleText: { color: color.textPrimary, fontWeight: '600' },
  memberList: { maxHeight: 240 },
  memberRow: { paddingVertical: space.md, minHeight: measure.hitTarget, justifyContent: 'center' },
  memberName: { color: color.textMuted, fontSize: typeRole.secondary.fontSize },
  memberOn: { color: color.brandMuted, fontWeight: '600' },
  hint: { color: color.textSecondary, fontSize: typeRole.caption.fontSize, lineHeight: 18 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  modalHit: { minHeight: measure.hitTarget, justifyContent: 'center' },
});
