import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, RootStackParamList } from '../../types';
import { threadRouteParams } from '../../types/link';
import { useAuthStore } from '../../stores/authStore';
import { useContactStore } from '../../stores/contactStore';
import { StorageService } from '../../services/StorageService';
import { ContactsService } from '../../services/ContactsService';
import { TrustEngine } from '../../services/TrustEngine';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ContactsScreen() {
  const nav = useNavigation<Nav>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const upsertContact = useContactStore(s => s.upsertContact);
  const storeContacts = useContactStore(s => Object.values(s.contacts));
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [nexusNote, setNexusNote] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    if (!ownerPubky) return;
    const [rows, pending] = await Promise.all([
      StorageService.getAllContacts(ownerPubky),
      StorageService.countPendingMessageRequests(ownerPubky),
    ]);
    for (const row of rows) {
      await TrustEngine.explain(row.pubky, ownerPubky);
    }
    const scored = await StorageService.getAllContacts(ownerPubky);
    scored.forEach(upsertContact);
    setPendingCount(pending);
  }, [ownerPubky, upsertContact]);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  const handleRefresh = useCallback(async () => {
    if (!ownerPubky) return;
    setRefreshing(true);
    setSyncing(true);
    try {
      const notes: string[] = [];
      const imported = await ContactsService.importFollows(ownerPubky);
      if (!imported.ok) {
        notes.push(`Import failed: ${imported.message}`);
      }
      const rel = await ContactsService.syncRelationships(ownerPubky);
      if (!rel.nexusReachable && rel.nexusError) {
        notes.push(rel.nexusError);
      }
      setNexusNote(notes.length > 0 ? notes.join('\n') : null);
      await loadLocal();
    } finally {
      setSyncing(false);
      setRefreshing(false);
    }
  }, [ownerPubky, loadLocal]);

  const sorted = sortContactsForDisplay(storeContacts);

  return (
    <ContactsScreenContent
      contacts={sorted}
      pendingCount={pendingCount}
      refreshing={refreshing}
      syncing={syncing}
      nexusNote={nexusNote}
      onRefresh={() => {
        void handleRefresh();
      }}
      onAdd={() => nav.navigate('ContactSearch')}
      onRequests={() => nav.navigate('MessageRequests')}
      onOpenChat={pubky => nav.navigate('Thread', threadRouteParams(pubky))}
    />
  );
}

function sortContactsForDisplay(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const rank = (c: Contact) => (c.isMutual ? 3 : c.isFollowing ? 2 : c.isFollower ? 1 : 0);
    const rankDiff = rank(b) - rank(a);
    if (rankDiff !== 0) return rankDiff;
    return b.trustScore - a.trustScore;
  });
}

export function ContactsScreenContent({
  contacts,
  pendingCount,
  refreshing,
  syncing,
  nexusNote,
  onRefresh,
  onAdd,
  onRequests,
  onOpenChat,
}: {
  contacts: Contact[];
  pendingCount: number;
  refreshing: boolean;
  syncing: boolean;
  nexusNote: string | null;
  onRefresh: () => void;
  onAdd: () => void;
  onRequests: () => void;
  onOpenChat: (pubky: string) => void;
}) {
  const renderContact = useCallback(
    ({ item }: { item: Contact }) => (
      <TouchableOpacity style={styles.row} onPress={() => onOpenChat(item.pubky)}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {(item.displayName ?? item.pubky).charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {item.displayName ?? shortPubky(item.pubky)}
          </Text>
          <Text style={styles.pubky} numberOfLines={1} ellipsizeMode="middle">
            {item.pubky}
          </Text>
          <View style={styles.badges}>
            {relationshipBadges(item).map(badge => (
              <View key={badge} style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ))}
          </View>
        </View>
      </TouchableOpacity>
    ),
    [onOpenChat],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onRequests} style={styles.requestsBtn}>
            <Text style={styles.requestsLabel}>Requests</Text>
            {pendingCount > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {pendingCount > 99 ? '99+' : pendingCount}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity onPress={onAdd}>
            <Text style={styles.add}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
      {syncing && !refreshing ? (
        <View style={styles.syncBar}>
          <ActivityIndicator size="small" color="#7c3aed" />
          <Text style={styles.syncText}>Updating follows…</Text>
        </View>
      ) : null}
      {nexusNote ? <Text style={styles.nexusNote}>{nexusNote}</Text> : null}
      {contacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No contacts yet.</Text>
          <Text style={styles.emptyHint}>Pull to import follows, or add someone by pubky.</Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={item => item.pubky}
          renderItem={renderContact}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />
          }
        />
      )}
    </SafeAreaView>
  );
}

function relationshipBadges(contact: Contact): string[] {
  const badges: string[] = [];
  if (contact.isMutual) badges.push('Mutual');
  else if (contact.isFollowing) badges.push('Following');
  if (contact.isFollower && !contact.isMutual) badges.push('Follower');
  if (contact.addedManually) badges.push('Added');
  return badges;
}

function shortPubky(pubky: string): string {
  return `${pubky.slice(0, 6)}…${pubky.slice(-4)}`;
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
  requestsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  requestsLabel: { color: '#7c3aed', fontSize: 16, fontWeight: '600' },
  countBadge: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  add: { fontSize: 28, color: '#7c3aed', fontWeight: '600' },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  syncText: { color: '#6b7280', fontSize: 13 },
  nexusNote: { color: '#f59e0b', fontSize: 12, paddingHorizontal: 20, paddingBottom: 8 },
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
  name: { fontSize: 15, fontWeight: '600', color: '#f9fafb' },
  pubky: { fontSize: 12, color: '#4b5563', fontFamily: 'monospace' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: {
    backgroundColor: '#1f2937',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { color: '#c4b5fd', fontSize: 11, fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyText: { color: '#6b7280', fontSize: 16 },
  emptyHint: { color: '#4b5563', fontSize: 14, textAlign: 'center' },
});
