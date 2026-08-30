import React, { useCallback, useEffect, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, RootStackParamList } from '../../types';
import type { GroupChannel } from '../../types/group';
import { GroupServiceError } from '../../types/group';
import { PRIVATE_GROUP_MEMBER_CAP } from '../../flags/config';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import {
  GroupService,
  takePendingPublicJoin,
  subscribeGroupEvents,
} from '../../services/group/GroupService';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ChannelsScreen() {
  const nav = useNavigation<Nav>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const [channels, setChannels] = useState<GroupChannel[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!ownerPubky) {
      setChannels([]);
      setContacts([]);
      return;
    }
    const [rows, people] = await Promise.all([
      GroupService.listChannels(),
      StorageService.getAllContacts(ownerPubky),
    ]);
    setChannels(rows);
    setContacts(people);
  }, [ownerPubky]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      const pending = takePendingPublicJoin();
      if (pending) {
        void GroupService.joinPublicChannel(pending)
          .then(ch => {
            nav.navigate('ChannelScreen', { channelId: ch.channelId });
          })
          .catch(err => {
            Alert.alert('Join failed', err instanceof Error ? err.message : String(err));
          });
      }
    }, [reload, nav]),
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
      createOpen={createOpen}
      joinOpen={joinOpen}
      busy={busy}
      memberCap={PRIVATE_GROUP_MEMBER_CAP}
      onOpenCreate={() => setCreateOpen(true)}
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
          Alert.alert(
            'Could not create group',
            err instanceof GroupServiceError ? err.message : String(err),
          );
        } finally {
          setBusy(false);
        }
      }}
      onCreatePublic={async name => {
        setBusy(true);
        try {
          const channel = await GroupService.createPublicChannel(name);
          setCreateOpen(false);
          await reload();
          nav.navigate('ChannelScreen', { channelId: channel.channelId });
        } catch (err) {
          Alert.alert(
            'Could not create channel',
            err instanceof GroupServiceError ? err.message : String(err),
          );
        } finally {
          setBusy(false);
        }
      }}
      onJoinPublic={async ref => {
        setBusy(true);
        try {
          const channel = await GroupService.joinPublicChannel(ref);
          setJoinOpen(false);
          await reload();
          nav.navigate('ChannelScreen', { channelId: channel.channelId });
        } catch (err) {
          Alert.alert(
            'Could not join',
            err instanceof GroupServiceError ? err.message : String(err),
          );
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
  createOpen,
  joinOpen,
  busy,
  memberCap,
  onOpenCreate,
  onCloseCreate,
  onOpenJoin,
  onCloseJoin,
  onCreatePrivate,
  onCreatePublic,
  onJoinPublic,
  onOpenChannel,
}: {
  channels: GroupChannel[];
  contacts: Contact[];
  createOpen: boolean;
  joinOpen: boolean;
  busy: boolean;
  memberCap: number;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onOpenJoin: () => void;
  onCloseJoin: () => void;
  onCreatePrivate: (name: string, memberPubkys: string[]) => void;
  onCreatePublic: (name: string) => void;
  onJoinPublic: (ref: string) => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [joinRef, setJoinRef] = useState('');

  const selectedPubkys = Object.keys(selected).filter(k => selected[k]);

  const renderChannel = useCallback(
    ({ item }: { item: GroupChannel }) => (
      <TouchableOpacity style={styles.row} onPress={() => onOpenChannel(item.channelId)}>
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
          <Text style={styles.meta} numberOfLines={1}>
            {item.isPublic ? 'Public channel' : 'Private group'}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [onOpenChannel],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Channels</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onOpenJoin}>
            <Text style={styles.action}>Join</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenCreate}>
            <Text style={styles.add}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
      {channels.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No channels yet.</Text>
          <Text style={styles.emptyHint}>Create a private group or join a public channel.</Text>
        </View>
      ) : (
        <FlatList
          data={channels}
          keyExtractor={item => item.channelId}
          renderItem={renderChannel}
          contentContainerStyle={styles.list}
        />
      )}

      <Modal visible={createOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New channel</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor="#4b5563"
            />
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggle, !isPublic && styles.toggleOn]}
                onPress={() => setIsPublic(false)}
              >
                <Text style={styles.toggleText}>Private group</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggle, isPublic && styles.toggleOn]}
                onPress={() => setIsPublic(true)}
              >
                <Text style={styles.toggleText}>Public</Text>
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
              <Text style={styles.hint}>
                Public channels are plaintext on the homeserver. Discovery is by invite link — Nexus
                does not index chat URIs.
              </Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={onCloseCreate} disabled={busy}>
                <Text style={styles.action}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy || name.trim().length === 0}
                onPress={() => {
                  if (isPublic) onCreatePublic(name);
                  else onCreatePrivate(name, selectedPubkys);
                }}
              >
                <Text style={styles.actionPrimary}>{busy ? '…' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={joinOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Join public channel</Text>
            <TextInput
              style={styles.input}
              value={joinRef}
              onChangeText={setJoinRef}
              placeholder="hypercolor://join-public?channel=…"
              placeholderTextColor="#4b5563"
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={onCloseJoin} disabled={busy}>
                <Text style={styles.action}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy || joinRef.trim().length === 0}
                onPress={() => onJoinPublic(joinRef)}
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
  action: { color: '#7c3aed', fontSize: 16, fontWeight: '600' },
  actionPrimary: { color: '#c4b5fd', fontSize: 16, fontWeight: '700' },
  add: { fontSize: 28, color: '#7c3aed', fontWeight: '600' },
  list: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
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
  time: { fontSize: 12, color: '#6b7280' },
  meta: { fontSize: 13, color: '#6b7280' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyText: { color: '#6b7280', fontSize: 16 },
  emptyHint: { color: '#4b5563', fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
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
    color: '#f9fafb',
    fontSize: 15,
  },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggle: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  toggleOn: { backgroundColor: '#4c1d95' },
  toggleText: { color: '#f9fafb', fontWeight: '600' },
  memberList: { maxHeight: 240 },
  memberRow: { paddingVertical: 8 },
  memberName: { color: '#9ca3af', fontSize: 14 },
  memberOn: { color: '#c4b5fd', fontWeight: '600' },
  hint: { color: '#6b7280', fontSize: 13, lineHeight: 18 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
});
